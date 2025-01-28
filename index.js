import * as Mexc from 'mexc-sdk';
import dotenv from 'dotenv';
import hmacSHA256 from 'crypto-js/hmac-sha256.js';

dotenv.config();

const apiKey = process.env.ACCESS_KEY;
const apiSecret = process.env.SECRET_KEY;
const client = new Mexc.Spot(apiKey, apiSecret);


function generateSignature(apiSecret, queryString) {
  const signature = hmacSHA256(queryString, apiSecret).toString();
  return signature;
}

async function createListenKey(apiKey, apiSecret) {
  const timestamp = Date.now();
  const queryString = `timestamp=${timestamp}`;
  const signature = generateSignature(apiSecret, queryString);

  const url = `https://api.mexc.com/api/v3/userDataStream?${queryString}&signature=${signature}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-MEXC-APIKEY": apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Error creating listenKey: ${response.status}`);
  }

  const data = await response.json();
  return data.listenKey;
}

// list listen key
async function getListenKey(apiKey, apiSecret) {
  const timestamp = Date.now();
  const queryString = `timestamp=${timestamp}`;
  const signature = generateSignature(apiSecret, queryString);

  const url = `https://api.mexc.com/api/v3/userDataStream?${queryString}&signature=${signature}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "X-MEXC-APIKEY": apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Error getting listenKey: ${response.status}`);
  }

  const data = await response.json();
  return data;
}

async function refreshListenKey(apiKey, apiSecret, listenKey) {
  const timestamp = Date.now();
  const queryString = `listenKey=${listenKey}&timestamp=${timestamp}`;
  const signature = generateSignature(apiSecret, queryString);

  const url = `https://api.mexc.com/api/v3/userDataStream?${queryString}&signature=${signature}`; // Replace with the actual refresh endpoint

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-MEXC-APIKEY": apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Error refreshing listenKey: ${response.status}`);
  }

  const data = await response.json();
  console.log(`ListenKey refreshed at ${new Date()}`, data);
}

function sniperBuyCaller(symbol, priceInUsdtToBuy) {
  if (symbol.sniperAlreadyBought === true) {
    console.log(`Sniper already bought for ${symbol.c}`);
    return;
  }

  if (symbol.lastBuyPrice === null) {
    console.error(`No price for ${symbol}`);
    return;
  }

  symbol.sniperAlreadyBought = true;
  symbol.sniper = false;

  const quantity = priceInUsdtToBuy / symbol.lastBuyPrice;
  console.log(`Buying ${quantity} of ${symbol.s} at ${symbol.lastBuyPrice} USDT`);

  try {
    const data = client.newOrder(
      symbol.s,
      'BUY',
      'LIMIT',
      {
        price: symbol.lastBuyPrice,
        quantity: quantity,
      }
    );
    console.log("buyOrder:", data);
  } catch (e) {
    console.error(e);
  }
}

const listenKey = await createListenKey(apiKey, apiSecret);


const ws = new WebSocket(`wss://wbs.mexc.com/ws?listenKey=${listenKey}`);

const moneyToFollow = [
  {
    "c": "spot@public.deals.v3.api@DYORUSDT",
    "s": "DYORUSDT",
    "lastBuyPrice": null,
    "lastSellPrice": null,
    "lastBuyQuantity": null,
    "sniper": true,
    "sniperAlreadyBought": false,
  },
]

if (moneyToFollow.length >= 30) {
  throw new Error('Too many symbols to follow, max is 30');
}

ws.onopen = () => {
  console.log(`Connection opened at ${new Date()}`);
  moneyToFollow.forEach((symbol) => {
    ws.send(`{ "method":"SUBSCRIPTION", "params":["${symbol.c}"]}`);
  });
};

setInterval(() => {
  ws.send(`{ "method":"PING"}`);
}, 30 * 1000); // ping every 30 seconds to keep the connection alive

setInterval(() => {
  refreshListenKey(apiKey, apiSecret, listenKey);
}, 30 * 60 * 1000); // refresh the listen key every 30 minutes to keep the connection alive

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.msg === 'PING') {
    console.log(`Server alive at ${new Date()}`);
    return;
  }

  if (data.id === 0 && data.code === 0) {
    const symbol = moneyToFollow.find((item) => item.c === data.msg);
    if (symbol) {
      console.log(`Correctly subscribed to ${symbol.c}`);
      return;
    }
  }

  if (data.id === 0 && data.code === 0) {
    const regex = data.msg.match(/Not Subscribed successfully! \[(.*?)\].\s*Reason：\s*Blocked!/);
    if (regex && regex[1]) {
      const symbol = regex[1];
      console.log(`try to subscribe ${symbol}, error: ${JSON.stringify(data)}`);
      ws.send(`{ "method":"SUBSCRIPTION", "params":["${symbol}"]}`);
      return;
    }
    return;
  }

  const symbol = moneyToFollow.find((item) => item.c === data.c);
  if (symbol) {
    console.log(`${symbol.s} - ${JSON.stringify(data.d.deals[0])}`);
    symbol.lastBuyQuantity = data.d.deals[0].v;
    if (data.d.deals[0].S === 1) // S = 1 is buy
      symbol.lastBuyPrice = data.d.deals[0].p;
    else if (data.d.deals[0].S === 2) // S = 2 is sell
      symbol.lastSellPrice = data.d.deals[0].p;
  }

  if (symbol && symbol.sniper === true && symbol.lastBuyPrice) {
    console.log(`Sniper mode activated for ${symbol.s}`);
    symbol.lastBuyPrice = symbol.lastBuyPrice - 1;
    sniperBuyCaller(symbol, 50);
  }
};

ws.onclose = () => {
  console.log(`Connection closed at ${new Date()}`);
};

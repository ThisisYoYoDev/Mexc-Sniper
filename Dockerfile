FROM node:23-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package.json ./

COPY ./mexc-api-sdk/ ./mexc-api-sdk/

COPY index.js ./

RUN npm install mexc-api-sdk/dist/js/mexc-sdk@1.0.0.jsii.tgz && npm install

ENTRYPOINT ["node", "index.js"]
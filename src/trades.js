#!/usr/bin/env node

/*
[
  CHANNEL_ID,
  <"te", "tu">,
  [
    ID,
    MTS,
    AMOUNT,
    PRICE
  ]
]
*/

const ws = require('ws')
const slugify = require('slugify')
const mongoose = require("mongoose");
const config = require("./config");
var request = require('request');

const options = {
    WebSocket: ws, // custom WebSocket constructor
    connectionTimeout: 1000,
    maxRetries: 10,
};

const ReconnectingWebSocket = require("reconnecting-websocket");

const Schema = mongoose.Schema;
const tradeSchema = new Schema({
    _id: Number,
    count: Number,
    totalAmount: Number,
    totalPrice: Number,
    changedPrice: Number,
    changedPriceUp: Number,
    changedPriceDown: Number,
    affectMax: Number,
    affectMin: Number,
    volume: Number,
    open: Number,
    high: Number,
    low: Number,
    close: Number,
    timestamp: Number,
})

function subscribeTo(w, currency) {
    // Trades
    const msg = JSON.stringify({
        event: "subscribe",
        channel: "trades",
        symbol: `t${currency}USD`
    });

    w.send(msg)
}

let listeners = {}

const getCurrentMinute = () => {
    const currentTime = new Date().getTime()
    return currentTime - (currentTime % 60000)
}


const makeSaveValues = (Model) => function saveValues(key, values) {
    const saveObj = {
        _id: values.timestamp
    }

    const entry = new Model(Object.assign(saveObj, values))
    return entry.save();
}

/*
  saveValues_ is a dependency instead of defined
  inside this function to make it testable without
  testing mongodb saving
*/
function makeCallback(key_, saveValues_) {
    const key = key_;
    const saveValues = saveValues_;
    //const Model = mongoose.model(slugify(key), candleSchema)
    let saveCount = 0;
    let lastTrade = {};

    const makeCurrentValues = (timestamp) => ({
        /* Comment to RAVI MADAN
         * All of these variables are stored minute by minute. So you dont have to worry about that.
         * You just need to add the variables in the same way as the others, and do a few if / else statements in the same fashion
         */

        count: 0, // in total, how many trades was executed during 1 minute

        countBuy: 0, // RAVI - in total, how many coins were bought during 1 minute
        countSell: 0, // RAVI - in total, how many coins were sold during 1 minute

        totalAmount: 0, // This is the total amount in a minute. can be +ve and -ve // i dont remember what this is :D can you check and add comment here?
        totalPrice: 0, // this is the total price in a minute. can be +ve and -ve // i dont remember what this is :D can you check and add comment here?

        changedPrice: 0, // how many of the trades did change the price during 1 minute
        changedPriceUp: 0, // how many of the trades did change the price up during 1 minute
        changedPriceDown: 0, // how many of the trades did change the price down during 1 minute
        
        affectMax: 0, // no of time price went up // i dont remember what this is :D can you check and add comment here?
        affectMin: 0, // no of time price went low // i dont remember what this is :D can you check and add comment here?
        
        volume: 0, // the sum of how many coins were traded, both buy and sell orders

        volumeBuy: 0, // RAVI - the sum of how many coins were traded through BUY orders (positive amount)
        volumeSell: 0, // RAVI - the sum of how many coins were traded through SELL orders (negative amount)

        biggestTrade: 0, // RAVI - the biggest trade during 1 minute, no matter if its a buy or sell order
        biggestTradeBuy: 0, // RAVI - the biggst BUY trade during 1 minute
        biggestTradeSell: 0, // RAVI - the biggest SELL trade during 1 minute

        averageTradeSize: 0, // RAVI - how big was the average trade (i think this would be amount / count)
        averageTradeSizeBuy: 0, // RAVI - same as above but for buy orders only
        averageTradeSizeSell: 0, // RAVI - same as above but for sell orders only

        open: NaN,
        high: 0,
        low: Infinity,
        close: NaN,
        timestamp
    })

    let currentValues = makeCurrentValues(getCurrentMinute());

    function tradeCallback(data) {
        /* SEQ is different from canonical ID. Websocket server uses SEQ strings
        to push trades with low latency. After a “te” message you receive 
        shortly a “tu” message that contains the real trade “ID”. */

        // data: [ 'tu', [ 300115645, 1538241139678, -0.00527062, 6575 ] ]
        //   ||  [ 'hb' ]

        if (data[0] == "te" || Array.isArray(data[0])) {
            return;
        }

        console.log('callback data', currentValues, data)

        if (data[0] == "hb") {
            // Check if currentTrade is older than a minute
            //   if it is, save it and start a new currentTrade

            if (getCurrentMinute() > currentValues.timestamp) {
                // If new minute and any values, save values
                if (currentValues.count > 0) {
                    console.log('-- Save', key, ++saveCount)
                    saveValues(key, currentValues)
                }

                // Start new count
                currentValues = makeCurrentValues(getCurrentMinute())
            }
            return;
        }

        const [id, timestamp, amount, price] = data[1]

        /*influx.writePoints([{
                measurement: 'trades',
                tags: { currency: key },
                fields: { price, amount },
            }])
            .then(() => console.log('saved trades to influxDB'))
            .catch(err => {
                console.error(`Error saving data to InfluxDB! ${err.stack}`)
            })*/


        //console.log('   Time diff: ', `Δ ${(timestamp - getCurrentMinute()) / 1000}s`)
        //console.log('   Time diff: ', `Δ ${(currentValues.timestamp - getCurrentMinute()) / 1000}s`)
        //console.log(' curr - last: ', `Δ ${(timestamp - currentValues.timestamp) / 1000}s`)

        if (timestamp - (timestamp % 60000) > currentValues.timestamp) {
            // If new minute And any values saved, save values
            if (currentValues.count > 0) {
                console.log('++ Save', key, ++saveCount)
                saveValues(key, currentValues)
            }

            // Start new count
            currentValues = makeCurrentValues(getCurrentMinute() - (getCurrentMinute() % 60000))
        }

        currentValues.count++;

        currentValues.totalAmount += amount;
        currentValues.averageAmount = currentValues.totalAmount / currentValues.count;

        // X hur stora var transaktionerna i snitt
        currentValues.totalPrice += price;
        currentValues.averagePrice = currentValues.totalPrice / currentValues.count;

        //Average Trade Size
        currentValues.averageTradeSize = Math.abs(currentValues.totalAmount / currentValues.count);
        
        // Trade Volume
        currentValues.volume += Math.abs(amount);

        // Trade Buy / Sell Volume
        if(amount>0) {
            currentValues.volumeBuy += Math.abs(amount);
            currentValues.countBuy += 1;
        } else {
            currentValues.volumeSell += Math.abs(amount);
            currentValues.countSell += 1;
        }

        //Average Trade Size Buy
        if(currentValues.countBuy>0) {
            currentValues.averageTradeSizeBuy = Math.abs(currentValues.volumeBuy / currentValues.countBuy);
        }
        
        //Average Trade Size Sell
        if(currentValues.countSell>0) {
            currentValues.averageTradeSizeSell = Math.abs(currentValues.volumeSell / currentValues.countSell);
        }

        if (price > currentValues.high) {
            currentValues.affectMax++;
            currentValues.high = price
        }

        if (price < currentValues.low) {
            currentValues.affectMin++;
            currentValues.low = price
        }

        // Biggest Trade Buy && Biggest Trade Sell
        if(amount > 0) {
            currentValues.biggestTradeSell = isNaN(lastTrade.biggestTradeSell) ? 0 : lastTrade.biggestTradeSell;
            if(lastTrade.amount > 0) {
                if(amount > lastTrade.amount) {
                    currentValues.biggestTradeBuy = amount;
                } else {
                    currentValues.biggestTradeBuy = lastTrade.amount;
                }
            } else {
                currentValues.biggestTradeBuy = amount; //isNaN(lastTrade.biggestTradeBuy) ? 0 : lastTrade.biggestTradeBuy;
            }

        } else {
            currentValues.biggestTradeBuy = isNaN(lastTrade.biggestTradeBuy) ? 0 : lastTrade.biggestTradeBuy;
            if(lastTrade.amount < 0) {
                if(amount < lastTrade.amount) {
                    currentValues.biggestTradeSell = amount;
                } else {
                    currentValues.biggestTradeSell = lastTrade.amount;
                }
            } else {
                currentValues.biggestTradeSell = Math.abs(amount); //isNaN(lastTrade.biggestTradeSell) ? 0 : lastTrade.biggestTradeSell;
            }
        }

        // X hur många av transaktionerna påverkade priset
        if (lastTrade.price && price !== lastTrade.price) {
            currentValues.changedPrice++;

            /*
            - hur många av transaktionerna påverkade priset uppåt
            - hur många av transaktionerna påverkade priset nedåt
            */
            if (price > lastTrade.price) {
                currentValues.changedPriceUp++;
            }
            else {
                currentValues.changedPriceDown++;
            }

            if(Math.abs(amount) > Math.abs(lastTrade.amount)) {
                biggestTrade = Math.abs(amount);
            } else {
                biggestTrade = Math.abs(lastTrade.amount);
            }

        }

        // Save first price (Is only NaN first time)        
        if (isNaN(currentValues.open)) {
            currentValues.open = price;
        }
        
        // Always save last price, will result in closing price when saved
        currentValues.close = price;
        biggestTradeBuy = Math.abs(currentValues.biggestTradeBuy);
        biggestTradeSell = Math.abs(currentValues.biggestTradeSell);

        // console.log('last trade: ' + lastTrade.timestamp);
        // console.log('current trade: ' + timestamp);

        lastVolume = amount * price;

        console.log(lastVolume);

        if (lastTrade.timestamp === timestamp) {
        	console.log('same timestamp');
        }

        if (amount * price > 100000) {
            sendSlackNotification(':four_leaf_clover: ' +addCommas(Math.round(amount * price)) + ' '+key.replace('t', '').replace('USD', '')+'');
        }

        if (amount * price < -100000) {
            sendSlackNotification(':diamonds: ' +addCommas(Math.round(amount * price)) + ' '+key.replace('t', '').replace('USD', '')+'');
        }

        lastTrade = { id, timestamp, amount, price, biggestTradeBuy, biggestTradeSell};


    }

    // Get values from tests
    tradeCallback.getValues = () => {
        return { key, saveCount, currentValues }
    }

    return tradeCallback
}

function channelSubscribe(_channel, chanId, key) {
    const Model = mongoose.model(slugify(`trades-${key}`), tradeSchema)
    const callback = makeCallback(key, makeSaveValues(Model))

    listeners[chanId] = {
        callback
    }
}

/*
//Event types
{"event":"info","version":2,"serverId":"8e1bd9aa-43aa-472b-8402-df7b647825d7","platform":{"status":1}}

Candles: {"event":"subscribed","channel":"candles","chanId":496557,"key":"trade:1m:tBTCUSD"}
 Trades: {"event":"subscribed","channel":"trades","chanId":2,"symbol":"tBTCUSD","pair":"BTCUSD"}
*/

function onMessage(msg) {
    // console.log('raw messsage:', msg.data)
    let parsedMessage
    try {
        parsedMessage = JSON.parse(msg.data)
    }
    catch (e) {
        console.log("Message too long?")
        console.error(e)
        return;
    }

    //console.log('parsed messsage:', parsedMessage)

    if (!Array.isArray(parsedMessage) && parsedMessage.event) {
        // Handle event types
        switch (parsedMessage.event) {
            case "info":
                break;
            case "subscribed":
                const { channel, chanId, symbol } = parsedMessage
                console.log('Subscribing to', channel, chanId, symbol)
                channelSubscribe(channel, chanId, symbol)
        }
    }
    else {
        const [channelId, ...data] = parsedMessage
        const listener = listeners[channelId]
        listener.callback(data)
    }
}

// Run if started as program
if (require.main === module) {

    const w = new ReconnectingWebSocket("wss://api.bitfinex.com/ws/2", [], options);

    mongoose.connect(config.mongoDbConnectionString, { useNewUrlParser: true });

    w.addEventListener("message", onMessage);

    w.addEventListener("open", () => {
        config.cryptoCurrencies.forEach((currency) => subscribeTo(w, currency))
    });

    w.addEventListener("close", () => {
        listeners = {} // Throw away old listeners on restart
    })
}

module.exports = {
    makeCallback
}

function sendSlackNotification(dataString) {
    var options = {
        url: 'https://hooks.slack.com/services/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',
        method: 'POST',
        headers: {
            "Content-Type": "application/json"
        },
        body: '{"text" : "'+dataString+'"}'
    }; 

    request(options, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            //console.log(body);
        }
    });
}

function addCommas(nStr) {
    nStr += '';
    x = nStr.split('.');
    x1 = x[0];
    x2 = x.length > 1 ? '.' + x[1] : '';
    var rgx = /(\d+)(\d{3})/;
    while (rgx.test(x1)) {
            x1 = x1.replace(rgx, '$1' + ' ' + '$2');
    }
    return x1 + x2;
}
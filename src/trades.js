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
const config = require("./config")

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
    affectMax: Number,
    affectMin: Number,
    minPrice: Number,
    maxPrice: Number,
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
    let saveCount = 0

    const makeCurrentValues = (timestamp) => ({
        count: 0,
        totalAmount: 0,
        totalPrice: 0,
        affectMax: 0,
        affectMin: 0,
        minPrice: Infinity,
        maxPrice: 0,
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

        /*
        - hur många av transaktionerna påverkade priset
        - hur många av transaktionerna påverkade priset uppåt
        - hur många av transaktionerna påverkade priset nedåt
        X hur stora var transaktionerna i snitt
        */

        currentValues.count++;

        currentValues.totalAmount += amount;
        currentValues.averageAmount = currentValues.totalAmount / currentValues.count;

        currentValues.totalPrice += price;
        currentValues.averagePrice = currentValues.totalPrice / currentValues.count;

        if (price > currentValues.maxPrice) {
            currentValues.affectMax++
                currentValues.maxPrice = price
        }

        if (price < currentValues.minPrice) {
            currentValues.affectMin++
                currentValues.minPrice = price
        }

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

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

mongoose.connect(config.mongoDbConnectionString, { useNewUrlParser: true });

const options = {
    WebSocket: ws, // custom WebSocket constructor
    connectionTimeout: 1000,
    maxRetries: 10,
};
const ReconnectingWebSocket = require("reconnecting-websocket");
const w = new ReconnectingWebSocket("wss://api.bitfinex.com/ws/2", [], options);

const Schema = mongoose.Schema;
const candleSchema = new Schema({
    _id: Number,
    mts: Number,
    open: Number,
    close: Number,
    high: Number,
    low: Number,
    volume: Number,
    tradeCount: Number,
})

function subscribeTo(w, currency) {
    /* // Trades
    const msg = JSON.stringify({
        event: "subscribe",
        channel: "trades",
        symbol: `t${currency}USD`
    });
    */
    let msg = JSON.stringify({
        event: 'subscribe',
        channel: 'candles',
        key: `trade:1m:t${currency}USD`
    })

    w.send(msg)
}

const cryptoCurrencies = [
    "BTC", "ETH", "XRP", "BCH", "EOS",
    "LTC", "NEO", "ETC", "IOT", "XMR",
    "ZEC", "BTG", "DSH", "ETP", "OMG",
    "XLM", "TRX", "XTZ", "BFT", "QTM",
    "ZRX", "GNT", "DAI", "SAN", "DTH",
    "EDO", "ELF", "XVG", "LYM", "BAT"
];

let listeners = {}

// Data: [1538227620000,6586.3,6585,6586.3,6585,48.50772522]
/*
MTS	int	millisecond time stamp
OPEN	float	First execution during the time frame
CLOSE	float	Last execution during the time frame
HIGH	float	Highest execution during the time frame
LOW 	float	Lowest execution during the timeframe
VOLUME  float	Quantity of symbol traded within the timeframe
*/

function makeCallback(key_) {
    const key = key_;
    const Model = mongoose.model(slugify(key), candleSchema)
    let saveCount = 0

    function candleCallback(data) {
        if (data[0] == "hb" || Array.isArray(data[0][0])) {
            return;
        }
        const [mts, open, close, high, low, volume] = data[0]

        const currentTime = (new Date()).getTime()
        const previousMinute = currentTime - (currentTime % 60000) - 60000

        console.log('Candle callback', key, mts, open, close, high, low, volume)
    
        if (previousMinute != mts) {
            // Discard current candle
            return
        }
        
        if (this.lastPrevious == previousMinute || this.saved == mts) {
            // Only save once
            return
        }
        
        this.lastPrevious = previousMinute
        this.saved = mts
        
        console.log('Save', key, ++saveCount)

        const entry = new Model({ _id: mts, mts, open, close, high, low, volume })
        entry.save();
    }
    return candleCallback
}

function channelSubscribe(_channel, chanId, key) {
    const callback = makeCallback(key)

    listeners[chanId] = {
        callback
    }
}

/*
//Event types
{"event":"info","version":2,"serverId":"8e1bd9aa-43aa-472b-8402-df7b647825d7","platform":{"status":1}}
{"event":"subscribed","channel":"candles","chanId":496557,"key":"trade:1m:tBTCUSD"}
*/

function onMessage(msg) {
    console.log('raw messsage:', msg.data)
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
                const { channel, chanId, key } = parsedMessage
                console.log('Subscribing to', channel, chanId, key)
                channelSubscribe(channel, chanId, key)
        }
    }
    else {
        const [channelId, ...data] = parsedMessage
        const listener = listeners[channelId]
        listener.callback(data)
    }
}

w.addEventListener("message", onMessage);

w.addEventListener("open", () => {
    cryptoCurrencies.forEach((currency) => subscribeTo(w, currency))
});

w.addEventListener("close", () => {
    listeners = {} // Throw away old listeners on restart
})

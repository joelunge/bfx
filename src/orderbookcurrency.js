const ws = require('ws')
const slugify = require('slugify')
const config = require("./config")
const _ = require('lodash')
var request = require('request');

const options = {
    WebSocket: ws, // custom WebSocket constructor
    connectionTimeout: 1000,
    maxRetries: 10,
};

const ReconnectingWebSocket = require("reconnecting-websocket");
const BOOK = {}
let seq = null

function subscribeTo(w, currency) {
    // Trades
    const msg = JSON.stringify({ event: "subscribe", channel: "book", symbol: `t${currency}USD`});
    const confEvent = JSON.stringify({ event: 'conf', flags: 65536 + 131072 })

    w.send(confEvent)
    w.send(msg)
}

let listeners = {}

const makeSaveValues = (Model) => function saveValues(key, values) {
    return true;
}

function makeCallback(key_) {
    const key = key_;
    let saveCount = 0
    BOOK[key] = { bids : {}, asks : {}, mcnt : 0}

    function orderbookCallback(msg) {
        if (msg.event) return
	    if (msg[0] === 'hb') {
	      seq = +msg[2]
	      return
	    } else if (msg[0] === 'cs') {
	      seq = +msg[2]

	      const checksum = msg[1]
	      const csdata = []
	      
	      return
	    }

	    if (BOOK[key].mcnt === 0) {
	      _.each(msg[0], function(pp, idx) {
	      	
	        pp = { id: pp[0], price: pp[1], amount: pp[2]}
	        const side = pp.amount >= 0 ? 'bids' : 'asks'
	        pp.amount = Math.abs(pp.amount)
	        BOOK[key][side][pp.id] = pp
	      })
	    } else {
	      const cseq = +msg[1]
	      msg = msg[0]
	      
	      if (!seq) {
	        seq = cseq - 1
	      }

	      if (cseq - seq !== 1) {
	      	return
	        //console.error('OUT OF SEQUENCE', seq, cseq)
	        //process.exit()
	      }

	      seq = cseq

	      const pp = { id: msg[0], price: msg[1], amount: msg[2]} 
	      if (!pp.price) {
	        let found = true
	        if (pp.amount > 0) {
	          if (BOOK[key]['bids'][pp.id]) {
	            delete BOOK[key]['bids'][pp.id]
	          } else {
	            found = false
	          }
	        } else if (pp.amount < 0) {
	          if (BOOK[key]['asks'][pp.id]) {
	            delete BOOK[key]['asks'][pp.id]
	          } else {
	            found = false
	          }
	        }
	        


	      } else {
	        const side = pp.amount >= 0 ? 'bids' : 'asks'
	        pp.amount = Math.abs(pp.amount)
	        BOOK[key][side][pp.id] = pp
	      }
	    }

	    BOOK[key].mcnt++

	    //console.log(BOOK)

	    if(JSON.stringify(BOOK[key].bids) != '{}' || BOOK[key].bids!='undefined') {
			totalBids = 0;
			totalBidPrice = 0;
			_.each(BOOK[key].bids, function(val) {
				totalBids+=Math.abs(val['amount'])
				totalBidPrice+=Math.abs(val['id'])
	      })
			
		}

		if(JSON.stringify(BOOK[key].asks) != '{}' || BOOK[key].asks!='undefined') {
			totalAsks = 0;
			totalAsksPrice = 0;
			_.each(BOOK[key].asks, function(val) {
				totalAsks+=Math.abs(val['amount'])
				totalAsksPrice+=Math.abs(val['id'])
	      })
			
		} 
		var factorValue = Math.round()
		if(totalBids > (10*totalAsks)) {
			console.log("For Currency Symbol "+key+", the Total Bids("+totalBids+") are ten(10) times larger than Total Asks("+ totalAsks +")")
			var dataString = ':four_leaf_clover: ' +key.substring(1, 4)+'  -  x'+Math.round(totalBids / totalAsks)  + '  -  '+ parseFloat(totalBids * (totalBidPrice / 25)).toFixed(0) +' USD';
			sendSlackNotification(dataString)
			
		}

		if(totalAsks > (10*totalBids)) {
			console.log("For Currency Symbol "+key+", the Total Asks("+totalAsks+") are ten(10) times larger than Total Bids("+ totalBids +")")
			var dataString = ':diamonds: ' +key.substring(1, 4)+'  -  x'+Math.round(totalAsks / totalBids) + '  -  '+ parseFloat(totalAsks * (totalAsksPrice / 25)).toFixed(0) +' USD';
			sendSlackNotification(dataString)
		}
	    
    }
    return orderbookCallback
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


function channelSubscribe(_channel, chanId, symbol) {
    const callback = makeCallback(symbol)

    listeners[chanId] = {
        callback
    }
}

function onMessage(msg) {
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
                //console.log('Subscribing to', channel, chanId, symbol)
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

    w.addEventListener("message", onMessage);

    w.addEventListener("open", () => {
    	console.log('WS open')
        config.cryptoCurrencies.forEach((currency) => subscribeTo(w, currency))
    });

    w.addEventListener("close", () => {
    	seq = null
    	console.log('WS close')
        listeners = {} // Throw away old listeners on restart
    })
}

module.exports = {
    makeCallback
}

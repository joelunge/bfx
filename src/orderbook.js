/*USAGE:
npm install ws lodash async moment crc-32
mkdir logs
node bfx_test_book.js BTCUSD
*/

const WS = require('ws')
const _ = require('lodash')
const async = require('async')

const pair = process.argv[2]

const conf = {
  wshost: "wss://api.bitfinex.com/ws/2"
}

const BOOK = {}

let connected = false
let connecting = false
let cli
let seq = null

function connect() {
  if (connecting || connected) return
  connecting = true

  cli = new WS(conf.wshost, { /*rejectUnauthorized: false*/ })
   
  cli.on('open', function open() {
    console.log('WS open')
    connecting = false
    connected = true
    BOOK.bids = {}
    BOOK.asks = {}
    BOOK.mcnt = 0
    cli.send(JSON.stringify({ event: 'conf', flags: 65536 + 131072 }))
    cli.send(JSON.stringify({ event: "subscribe", channel: "book", symbol: 'tBTCUSD' }))
  })

  cli.on('close', function open() {
    seq = null
    console.log('WS close')
    connecting = false
    connected = false
  })

  cli.on('message', function(msg) {
    msg = JSON.parse(msg)
    if (msg.event) return
    if (msg[1] === 'hb') {
      seq = +msg[2]
      return
    } else if (msg[1] === 'cs') {
      seq = +msg[3]

      const checksum = msg[2]
      const csdata = []
      
      return
    }

    if (BOOK.mcnt === 0) {
      _.each(msg[1], function(pp, idx) {
      	
        pp = { id: pp[0], price: pp[1], amount: pp[2]}
        const side = pp.amount >= 0 ? 'bids' : 'asks'
        pp.amount = Math.abs(pp.amount)
        BOOK[side][pp.id] = pp
      })
    } else {
      const cseq = +msg[2]
      msg = msg[1]
      
      if (!seq) {
        seq = cseq - 1
      }

      if (cseq - seq !== 1) {
        console.error('OUT OF SEQUENCE', seq, cseq)
        process.exit()
      }

      seq = cseq

      const pp = { id: msg[0], price: msg[1], amount: msg[2]} // , ix: msg[3] 
      
      if (!pp.price) {
        let found = true
        if (pp.amount > 0) {
          if (BOOK['bids'][pp.id]) {
            delete BOOK['bids'][pp.id]
          } else {
            found = false
          }
        } else if (pp.amount < 0) {
          if (BOOK['asks'][pp.id]) {
            delete BOOK['asks'][pp.id]
          } else {
            found = false
          }
        }
        


      } else {
        const side = pp.amount >= 0 ? 'bids' : 'asks'
        pp.amount = Math.abs(pp.amount)
        BOOK[side][pp.id] = pp
      }
    }

    BOOK.mcnt++
  })
}

setInterval(function() {
  if (connected) return
  connect()
}, 3500)

function saveBook() {
	
	if(JSON.stringify(BOOK.bids) != '{}' || BOOK.bids!='undefined') {
		totalBids = 0;
		_.each(BOOK.bids, function(val) {
			totalBids+=Math.abs(val['amount'])
      })
		
	}

	if(JSON.stringify(BOOK.asks) != '{}' || BOOK.asks!='undefined') {
		totalAsks = 0;
		_.each(BOOK.asks, function(val) {
			totalAsks+=Math.abs(val['amount'])
      })
		
	} 

	if(totalBids > (10*totalAsks)) {
		console.log("Total Bids("+totalBids+") are ten(10) times larger than Total Asks("+ totalAsks +")")
	}

	

}

setInterval(function() {
  saveBook()
}, 1000)

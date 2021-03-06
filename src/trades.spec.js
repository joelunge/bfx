/* global jest expect */
const { makeCallback } = require('./trades')

const _Date = Date;
let DATE_TO_USE;
global.Date = jest.fn(() => {
    return new _Date(DATE_TO_USE)
});

function setDate(date) {
    DATE_TO_USE = date
}

function initCallback () {
    return {callback : makeCallback('FAKE', () => {})}
}

describe('trades', () => {
    it('counts values', () => {
        const startDate = 0
        setDate(startDate)
        const {callback} = initCallback()
        callback(['tu', [300166111, startDate + 31438, 0.00836822, 6598.6]])
        callback(['tu', [300166112, startDate + 50000, 0.00836822, 6598.6]])

        // Expect count to be 2
        const { currentValues, saveCount } = callback.getValues()
        expect(currentValues.count).toBe(2)
        expect(saveCount).toBe(0)
    })

    it('resets count values next minute', () => {
        const startDate = 0
        setDate(startDate)
        const {callback} = initCallback()
        callback(['tu', [300166111, startDate + 31438, 0.00836822, 6598.6]])
        callback(['tu', [300166112, startDate + 50000, 0.00836822, 6598.6]])
        setDate(startDate + 70001)
        callback(['tu', [300166113, startDate + 70001, 0.00836822, 6598.6]])

        // Expect count to be 1
        const { currentValues, saveCount } = callback.getValues()
        expect(currentValues.count).toBe(1)
        expect(saveCount).toBe(1)
    })

    it('resets count on heartbeat on next minute', () => {
        const startDate = 0
        setDate(startDate)
        const {callback} = initCallback()
        callback(['tu', [300166111, startDate + 31438, 0.00836822, 6598.6]])
        callback(['tu', [300166112, startDate + 50000, 0.00836822, 6598.6]])
        setDate(startDate + 70001)
        callback(['hb'])

        const { currentValues, saveCount } = callback.getValues()
        expect(currentValues.count).toBe(0)
        expect(saveCount).toBe(1)
    })

    it('keeps a running average of prices', () => {
        const startDate = 0
        setDate(startDate)
        const {callback} = initCallback()
        const P1 = 10
        const P2 = 20
        const P3 = 30
        callback(['tu', [300166111, startDate + 31438, 0.00836822, P1]])
        callback(['tu', [300166112, startDate + 50000, 0.00836822, P2]])
        callback(['tu', [300166112, startDate + 50000, 0.00836822, P3]])

        const { currentValues } = callback.getValues()
        expect(currentValues.averagePrice).toBe((P1 + P2 + P3) / 3)
    })

    it('keeps a running average of amount', () => {
        const startDate = 0
        setDate(startDate)
        const {callback} = initCallback()
        const P1 = 10
        const P2 = 20
        const P3 = 30
        callback(['tu', [300166111, startDate + 31438, P1, 0.00836822]])
        callback(['tu', [300166112, startDate + 50000, P2, 0.00836822]])
        callback(['tu', [300166112, startDate + 50000, P3, 0.00836522]])

        const { currentValues } = callback.getValues()
        expect(currentValues.averageAmount).toBe((P1 + P2 + P3) / 3)
    })
    
    it('records minimum and maximum price', () => {
        const startDate = 0
        setDate(startDate)
        const {callback} = initCallback()
        callback(['tu', [300166111, startDate + 31438, 1, 1]])
        callback(['tu', [300166112, startDate + 50000, 1, 2]])
        callback(['tu', [300166112, startDate + 50000, 1, 3]])

        const { currentValues } = callback.getValues()
        expect(currentValues.minPrice).toBe(1)
        expect(currentValues.maxPrice).toBe(3)
    })
    
    it('records how many trades affected max price up and down', () => {
        const startDate = 0
        setDate(startDate)
        const {callback} = initCallback()
        callback(['tu', [300166111, startDate + 31438, 1, 1]])// max/min
        callback(['tu', [300166112, startDate + 50001, 1, 2]])// max
        callback(['tu', [300166112, startDate + 50002, 1, 1.9]]) // -
        callback(['tu', [300166112, startDate + 50003, 1, 1]]) // -
        callback(['tu', [300166112, startDate + 50004, 1, 0.9]]) // min

        const { currentValues } = callback.getValues()
        expect(currentValues.affectMax).toBe(2)
        expect(currentValues.affectMin).toBe(2)
    })
    
    it('records how many trades affected price', () => {
        const startDate = 0
        setDate(startDate)
        const {callback} = initCallback()

        callback(['tu', [300166111, startDate + 31438, 1, 1]]) // no change
        callback(['tu', [300166112, startDate + 31439, 1, 1]]) // no change
        callback(['tu', [300166113, startDate + 31440, 1, 2]]) // change up
        callback(['tu', [300166114, startDate + 31441, 1, 3]]) // change up
        callback(['tu', [300166115, startDate + 31442, 1, 3]]) // no change
        callback(['tu', [300166116, startDate + 31443, 1, 1]]) // change down
        
        
        const { currentValues } = callback.getValues()
        expect(currentValues.changedPrice).toBe(3)
        expect(currentValues.changedPriceUp).toBe(2)
        expect(currentValues.changedPriceDown).toBe(1)
    })
});

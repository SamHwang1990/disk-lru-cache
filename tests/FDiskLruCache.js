/**
 * Created by zhiyuan.huang@ddder.net.
 */

'use strict';

const FDiskLruCache = require('../FDiskLruCache.js');
const assert = require('../../utils/assert/index.js');

module.exports = {
    init: function() {
        let fDiskLruCache = new FDiskLruCache();

        fDiskLruCache.put('simpleStr', 'simpleStringContent');
        assert.equal(fDiskLruCache.getString('simpleStr'), 'simpleStringContent');

        let compoundValue = {a: 1, b: '2', c: [1, 2], d: true, e: {a: 2}};
        compoundValue.f = compoundValue;

        fDiskLruCache.putArrayObjectLike('compoundValue', compoundValue);
        const compoundGetValue = fDiskLruCache.getArrayObjectLike('compoundValue');

        assert.equal(compoundGetValue.a, 1);
        assert.equal(compoundGetValue.b, '2');
        assert.equal(compoundGetValue.c[0], 1);
        assert.equal(compoundGetValue.c[1], 2);
        assert.equal(compoundGetValue.d, true);
        assert.equal(compoundGetValue.e.a, 2);

        assert.equal(compoundGetValue.f.a, 1);
        assert.equal(compoundGetValue.f.a, 1);
        assert.equal(compoundGetValue.f.b, '2');
        assert.equal(compoundGetValue.f.c[0], 1);
        assert.equal(compoundGetValue.f.c[1], 2);
        assert.equal(compoundGetValue.f.d, true);
        assert.equal(compoundGetValue.f.e.a, 2);
    }
};
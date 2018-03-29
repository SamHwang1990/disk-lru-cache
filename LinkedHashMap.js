/**
 * Created by zhiyuan.huang@ddder.net.
 */

'use strict';

const CreateClass = require('./classify.js').create;

const LinkedHashMap = CreateClass({
    initialize: function() {
        this.map = {};
        this.head = null;
        this.tail = null;
    },
    push: function(key, payload) {
        this.pop(key);

        const item = {
            key,
            payload,
            prev: null,
            next: this.head
        };

        if (this.head) {
            this.head.prev = item;
        }
        this.head = item;

        if (!this.tail) {
            this.tail = item;
        }

        this.map[key] = item;

        return this;
    },
    pop: function(key) {
        const item = this.map[key];

        if (!item) return;
        this._removeItem(item);

        return item.payload;
    },
    size: function() {
        return Object.keys(this.map).length;
    },

    // 每次get 都会将key 优先级提到最高
    get: function(key) {
        let item = this.map[key];
        if (!item) return null;

        this.pop(item.key);
        this.push(key, item.payload);

        return item.payload;
    },

    _removeItem: function(item) {
        if (this.head === item) {
            this.head = item.next;
        }

        if (this.tail === item) {
            this.tail = item.prev;
        }

        if (item.next) {
            item.next.prev = item.prev;
        }

        if (item.prev) {
            item.prev.next = item.next;
        }

        delete this.map[item.key];
    }
})

module.exports = LinkedHashMap;
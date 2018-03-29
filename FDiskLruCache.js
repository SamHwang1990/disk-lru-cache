/**
 * Created by zhiyuan.huang@ddder.net.
 *
 * 基于DiskLruCache.js 封装一个更友好的api
 *
 * 用法：
 * 1. 创建Helper 对象：
 * const helper = new FriendlyDiskLruCacheHelper({...});
 *
 * 2. 读取文件：
 * helper.getString(fileName);
 * helper.getArrayObjectLike(fileName);
 *
 * 3. 写入文件：
 * helper.put(fileName, stingContent);
 * helper.putArrayObjectLike(fileName, arrayObjectLikeContent);
 */

'use strict';

const DEFAULT_DIR = getPath('data/cache/');
const MAX_COUNT = 5 * 1024 * 1024;
const DEFAULT_APP_VERSION = 1;

const { open, writeString, flushOutputDist, closeOutputDist } = require('./DiskLruCache.js');

const CreateClass = require('./classify.js').create;

const FriendlyDiskLruCacheHelper = CreateClass({
    /**
     * @param {Object} options An object with options
     * @param {string=} options.directory Sets the base directory of cache.
     * @param {string=} options.appVersion Set the appVersion of DiskLruCache.
     * @param {string=} options.maxSize Set the max size of cache directory.
     */
    initialize: function(options = {}) {
        if (!options) options = {};

        let directory = options.directory || DEFAULT_DIR;
        let appVersion = options.appVersion || DEFAULT_APP_VERSION;
        let valueCount = 1;
        let maxSize = options.maxSize || MAX_COUNT;

        this.diskLruCache = open(directory, appVersion, valueCount, maxSize);
    },

    close: function() {
        if (this.diskLruCache) {
            this.diskLruCache.close();
        }

        this.diskLruCache = null;
    },

    /**
     * @param {string} key File name to be got
     * @return {(FileInputStream|null)}
     * */
    getInputStream: function(key) {
        if (!key) {
            log('get input stream failed', '!key');
            return null;
        }

        try {
            let snapshot = this.diskLruCache.getSnapshot(key);

            if (snapshot == null) {
                log('can not find snapshot: ', key);
                return null;
            }

            return snapshot.getInputStream(0);
        } catch (e) {
            log(e.message);
            return null;
        }
    },

    /**
     * @param {string} key file name to be got
     * @return {(DiskLruCache.Editor|null)}
     * */
    getEditor: function(key) {
        if (!key) {
            log('get editor failed', '!key');
            return null;
        }

        try {
            let editor = this.diskLruCache.getEditor(key);
            return editor;
        } catch(e) {
            log(e.message);
            return null;
        }
    },

    remove: function(key) {
        if (!key) {
            log('remove failed', '!key');
            return false;
        }

        try {
            return this.diskLruCache.remove(key);
        } catch (e) {
            log('remove failed', e.message);
            return false;
        }
    },

    /**
     * @param {string} key File name to be put
     * @param {string} strValue String type content to be put
     * */
    put: function(key, strValue) {
        if (!key || strValue == null) return;

        let editor = null;
        let outputDist = null;

        try {
            editor = this.getEditor(key);

            if (editor == null) return;

            outputDist = editor.newOutputDist(0);
            writeString(outputDist, strValue);
            flushOutputDist(outputDist);

            editor.commit();
        } catch (e) {
            log(e.message);
            try {
                editor && editor.abort();
            } catch(e) {
                log(e.message);
            }
        } finally {
            editor = null;
            if (outputDist) {
                closeOutputDist(outputDist);
                outputDist = null;
            }
        }
    },

    /**
     * @param {string} key File name to be got
     * @return {string}
     * */
    getString: function(key) {
        if (!key) return;

        let inputStream = null;

        try {
            inputStream = this.getInputStream(key);

            if (!inputStream) return '';

            return inputStream.readEntireStreamAsString();
        } catch(e) {
            log(e.message);
        } finally {
            if (inputStream) {
                destroyObject(inputStream);
                inputStream = null;
            }
        }
    },

    /**
     * @param {string} key File name to be put
     * @param {(Object|Array)} value Object or Array type content to be put
     * */
    putArrayObjectLike: function(key, value) {
        if (!key) return;

        if (!value) {
            this.put(key, '');
        } else {
            this.put(key, JSON.stringify(JSON.decycle(value)));
        }
    },

    /**
     * @param {string} key File name to be got
     * @return {(Object|Array)}
     * */
    getArrayObjectLike: function(key) {
        let strValue = this.getString(key);

        if (!strValue) return null;

        try {
            return JSON.retrocycle(JSON.parse(strValue));
        } catch (e) {
            log(e.message);
            return null;
        }
    }
});

module.exports = FriendlyDiskLruCacheHelper;
/**
 * Created by zhiyuan.huang@ddder.net.
 */

'use strict';

const CreateClass = require('./classify.js').create;

const LinkedHashMap = require('./LinkedHashMap.js');

let nextQueueNumber = 0;

const JOURNAL_FILE = 'journal';
const JOURNAL_FILE_TMP = 'journal.tmp';

const MAGIC = 'Ddder-DiskLruCache';
const VERSION_1 = '1';
const ANY_SEQUENCE_NUMBER = -1;

const cacheTransType = {
    DIRTY: 'DIRTY',
    CLEAN: 'CLEAN',
    REMOVE: 'REMOVE',
    READ: 'READ'
};

const supportConcurrentOutputStream = Platform.getPlatformOS() !== 0;

function deleteIfExists(file) {
    if (file.existsAsFile()) {
        file.deleteFile();
    }
}

function writeString(dest, ...strs) {
    if (dest instanceof OutputStream) {
        strs.forEach(str => {
            dest.writeText(str, false, false);
        })
    } else if (dest instanceof File) {
        strs.forEach(str => {
            dest.appendText(str);
        })
    }
}

function closeStream(stream) {
    destroyObject(stream);
}

const Entry = CreateClass({
    initialize: function(directory, key, valueCount = 1) {
        this.directory = directory;
        this.key = key;
        this.sizes = new Array(valueCount).fill(0);

        this.currentEditor = null;
        this.readable = false;
        this.sequenceNumber = 0;
    },
    getSizes: function() {
        return this.sizes.map(s => s || 0).join(' ');
    },
    setSizes: function(sizes) {
        if (!Array.isArray(sizes)) {
            throw new Error('sizes is not array');
        }

        if (sizes.length !== this.sizes.length) {
            throw new Error('unexpected journal line: ', sizes.toString());
        }

        sizes.forEach((s, i) => {
            this.sizes[i] = parseInt(s);
        });
    },
    getCleanFile: function(i) {
        return new File([this.directory, this.key, '.', i].join(''));
    },
    getDirtyFile: function(i) {
        return new File([this.directory, this.key, '.', i, '.tmp'].join(''));
    }
});

const Editor = CreateClass({
    initialize: function(diskCache, entry) {
        this.diskCache = diskCache;
        this.entry = entry;
        this.hasErrors = false;
    },
    commit: function() {
        if (this.hasErrors) {
            this.diskCache._completeEdit(this, false);
            this.diskCache.remove(this.entry.key);
        } else {
            this.diskCache._completeEdit(this, true);
        }
    },
    abort: function() {
        this.diskCache._completeEdit(this, false);
    },
    newInputStream: function(i) {
        if (this.entry.currentEditor !== this) return null;
        return this.entry.getCleanFile(i).createInputStream();
    },
    newOutputDist: function(i) {
        if (this.entry.currentEditor !== this) return null;
        if (supportConcurrentOutputStream) return this.newOutputStream(i);

        return this.entry.getDirtyFile(i);
    },
    newOutputStream: function(i) {
        if (this.entry.currentEditor !== this) return null;
        let self = this;
        let stream = this.entry.getDirtyFile(i).createOutputStream();

        // FIXME: 下面的Proxy 有点猥琐
        let outputStreamProxy = new Proxy(stream, {
            get: function(target, property) {
                if (typeof target[property] === 'function') {
                    return function(...args) {
                        let result = target[property].apply(target, args);

                        if (property.indexOf('write') === 0 && result === false) {
                            self.hasErrors = true;
                        }

                        return result;
                    }
                }
            }
        });

        return Object.create(outputStreamProxy, { stream });
    }
});

const Snapshot = CreateClass({
    initialize: function(diskCache, key, sequenceNumber, inputStreams) {
        this.diskCache = diskCache;
        this.key = key;
        this.sequenceNumber = sequenceNumber;
        this.ins = inputStreams;
    },
    edit: function() {
        return this.diskCache._edit(this.key, this.sequenceNumber);
    },
    getInputStream: function(i) {
        return this.ins[i];
    },
    close: function() {
        this.ins.forEach(stream => closeStream(stream));
    }
});

const DiskLruCache = CreateClass({
    initialize: function(directory, appVersion, valueCount, maxSize) {
        this.directory = directory;
        this.appVersion = appVersion + '';
        this.valueCount = valueCount;

        this._maxSize = maxSize;
        this._size = 0;

        this.journalFile = new File(directory + JOURNAL_FILE);
        this.journalFileTmp = new File(directory + JOURNAL_FILE_TMP);

        this.lruEntries = new LinkedHashMap();
        this.journalWriter = null;
    },

    readJournal: function() {
        const stream = new FileInputStream(this.journalFile);
        try {
            const magic = stream.readNextLine();
            const version = stream.readNextLine();
            const appVersionString = stream.readNextLine();
            const valueCountString = stream.readNextLine();
            const blank = stream.readNextLine();

            if (MAGIC !== magic
                || VERSION_1 !== version
                || this.appVersion !== appVersionString
                || (this.valueCount + '') !== valueCountString
                || blank !== '') {
                throw new Error("unexpected journal header: ["
                    + magic + ", " + version + ", " + valueCountString + ", " + blank + "]");
            }
            while (!stream.isExhausted()) {
                try {
                    this.readJournalLine(stream.readNextLine());
                } catch (error) {
                    break;
                }
            }
        } catch(e) {

        }
    },

    readJournalLine: function(line) {
        const parts = line.split(" ");

        if (parts.length < 2) {
            throw new Error("unexpected journal line: " + line);
        }

        const key = parts[1];
        if (cacheTransType.REMOVE === parts[0] && parts.length === 2) {
            this.lruEntries.pop(key);
            return;
        }

        let entry = this.lruEntries.get(key);

        if (entry === null) {
            entry = new Entry(this.directory, key, this.valueCount);
            this.lruEntries.push(key, entry);
        }
        if (cacheTransType.CLEAN === parts[0] && parts.length === 2 + this.valueCount) {
            entry.readable = true;
            entry.currentEditor = null;
            entry.setSizes(parts.slice(2));
        } else if (cacheTransType.DIRTY === parts[0] && parts.length === 2) {
            entry.currentEditor = new Editor(this, entry);
        } else if (cacheTransType.READ === parts[0] && parts.length === 2) {
            // this work was already done by calling this.lruEntries.get()
        } else {
            throw new Error("unexpected journal line: " + line);
        }
    },

    processJournal: function() {
        deleteIfExists(this.journalFileTmp);
        let entryItem = this.lruEntries.head;

        while(entryItem) {
            let entry = entryItem.payload;

            if (entry.currentEditor === null) {
                entry.sizes.forEach(s => {
                    this._size += s;
                })
            }

            entryItem = entryItem.next;
        }
    },

    rebuildJournal: function() {
        const journalTmpFile = this.journalFileTmp;

        if (this.journalWriter !== null) {
            closeStream(this.journalWriter);
        }

        deleteIfExists(journalTmpFile);

        const writer = createOutputDist(journalTmpFile)

        writeString(
            writer,
            MAGIC,
            '\n',
            VERSION_1,
            '\n',
            this.appVersion,
            '\n',
            this.valueCount + '',
            '\n',
            '\n');

        let entryItem = this.lruEntries.head;

        while(entryItem) {
            let entry = entryItem.payload;

            if (entry.currentEditor === null) {
                writeString(writer, cacheTransType.DIRTY + ' ' + entry.key + '\n');
            } else {
                writeString(writer, cacheTransType.CLEAN + ' ' + entry.key + entry.getSizes() + '\n');
            }

            entryItem = entryItem.next;
        }

        flushOutputDist(writer);
        closeOutputDist(writer);

        journalTmpFile.moveFileTo(this.journalFile);
        this.journalWriter = createOutputDist(this.journalFile)
    },

    getSnapshot: function(key) {
        this._checkNotClosed();
        this._validateKey(key);

        const entry = this.lruEntries.get(key);

        if (entry === null) {
            return null;
        }

        if (!entry.readable) {
            return null;
        }

        let ins = new Array(this.valueCount);

        try {
            for (let i = 0; i < this.valueCount; i++) {
                ins[i] = entry.getCleanFile(i).createInputStream();
            }
        } catch (err) {
            // a file must have been deleted manually!
            return null;
        }

        this.journalFile.appendText(cacheTransType.READ + ' ' + key + '\n');
        return new Snapshot(this, key, entry.sequenceNumber, ins);
    },

    getEditor: function(key) {
        return this._edit(key, ANY_SEQUENCE_NUMBER);
    },

    _edit: function(key, expectedSequenceNumber) {
        this._checkNotClosed();
        this._validateKey(key);

        let entry = this.lruEntries.get(key);

        if (expectedSequenceNumber !== ANY_SEQUENCE_NUMBER
            && (entry === null || entry.sequenceNumber !== expectedSequenceNumber)) {
            return null; // snapshot is stale
        }

        if (entry === null) {
            entry = new Entry(this.directory, key, this.valueCount);
            this.lruEntries.push(key, entry);
        } else if (entry.currentEditor !== null) {
            return null; // another edit is in progress
        }

        let editor = new Editor(this, entry);
        entry.currentEditor = editor;
        // flush the journal before creating files to prevent file leaks
        writeString(this.journalWriter, cacheTransType.DIRTY + ' ' + key + '\n');
        flushOutputDist(this.journalWriter);
        return editor;
    },

    _completeEdit: function(editor, success) {
        const entry = editor.entry;

        if (entry.currentEditor !== editor) {
            throw new Error('entry.currentEditor !== editor')
        }

        // if this edit is creating the entry for the first time, every index must have a value
        if (success && !entry.readable) {
            for (let i = 0; i < this.valueCount; i++) {
                if (!entry.getDirtyFile(i).existsAsFile()) {
                    editor.abort();
                    throw new Error("edit didn't create file " + i);
                }
            }
        }

        for (let i = 0; i < this.valueCount; i++) {
            const dirty = entry.getDirtyFile(i);
            if (success) {
                if (dirty.existsAsFile()) {
                    const clean = entry.getCleanFile(i);
                    dirty.moveFileTo(clean);
                    const oldLength = entry.sizes[i];
                    const newLength = clean.getSize();
                    entry.sizes[i] = newLength;
                    this._size = this._size - oldLength + newLength;
                }
            } else {
                deleteIfExists(dirty);
            }
        }
        entry.currentEditor = null;
        if (entry.readable | success) {
            entry.readable = true;
            writeString(this.journalWriter, cacheTransType.CLEAN, ' ', entry.key, ' ', entry.getSizes(), '\n');
            if (success) {
                entry.sequenceNumber = nextQueueNumber++;
            }
        } else {
            this.lruEntries.pop(entry.key);
            writeString(this.journalWriter, cacheTransType.REMOVE, ' ', entry.key, '\n');
        }

        if (this._size > this._maxSize) {
            this._trimToSize();
        }

        flushOutputDist(this.journalWriter);
    },

    _trimToSize: function() {
        while(this._size > this._maxSize && this.lruEntries.size()) {
            let toEvict = this.lruEntries.tail;

            if (toEvict == null) {
                break;
            }

            this.remove(toEvict.key);
        }
    },

    maxSize: function() {
        return this._maxSize;
    },

    size: function() {
        return this._size;
    },

    remove: function(key) {
        this._checkNotClosed();
        this._validateKey(key);

        const entry = this.lruEntries.get(key);

        if (entry === null || entry.currentEditor !== null) {
            return false;
        }

        for (let i = 0; i < this.valueCount; i++) {
            const file = entry.getCleanFile(i);
            if (!file.deleteFile()) {
                throw new Error("failed to delete " + file);
            }
            this._size -= entry.sizes[i];
            entry.sizes[i] = 0;
        }
        this.lruEntries.pop(key);
        writeString(this.journalWriter, cacheTransType.REMOVE + ' ' + key + '\n');
        return true;
    },

    flush: function() {
        this._checkNotClosed();
        this._trimToSize();
        flushOutputDist(this.journalWriter);
    },

    isClosed: function() {
        return this.journalWriter === null || !getObjectId(this.journalWriter);
    },

    _checkNotClosed: function() {
        if (this.isClosed()) {
            throw new Error('cache is closed');
        }
    },

    close: function() {
        if (this.isClosed()) {
            return;     // already closed
        }

        let entryItems = this.lruEntries.map;
        Object.keys(entryItems).forEach(key => {
            let entry = entryItems[key];
            if (entry !== null) {
                entry.payload.currentEditor && entry.payload.currentEditor.abort();
            }
        });
        this._trimToSize();
        closeStream(this.journalWriter);
        this.journalWriter = null;
    },

    clean: function() {
        this.close();
        new File(this.directory).deleteRecursively();
    },

    _validateKey: function(key) {
        if (/\s/g.test(key)) {
            throw new Error(
                "keys must not contain spaces or newlines: \"" + key + "\"");
        }
    }
});

function createOutputDist(file) {
    if (!file) return null;
    return !supportConcurrentOutputStream ? file : file.createOutputStream();
}

function flushOutputDist(dist) {
    if (dist instanceof OutputStream) {
        dist.flush();
    }
}

function closeOutputDist(dist) {
    if (dist instanceof OutputStream) {
        closeStream(dist);
    }
}

function open(directory, appVersion, valueCount, maxSize) {
    if (maxSize <= 0) {
        throw new Error("maxSize <= 0");
    }
    if (valueCount <= 0) {
        throw new Error("valueCount <= 0");
    }
    // prefer to pick up where we left off
    let cache = new DiskLruCache(directory, appVersion, valueCount, maxSize);
    if (cache.journalFile.existsAsFile()) {
        try {
            cache.readJournal();
            cache.processJournal();
            cache.journalWriter = createOutputDist(cache.journalFile);
            return cache;
        } catch (journalIsCorrupt) {
            // System.logW("DiskLruCache " + directory + " is corrupt: "
            //     + journalIsCorrupt.getMessage() + ", removing");
            cache.delete();
        }
    }
    // create a new empty cache
    const directoryFile = new File(directory);
    directoryFile.createDirectory();

    cache = new DiskLruCache(directory, appVersion, valueCount, maxSize);
    cache.rebuildJournal();
    return cache;
}

const defaultCacheDirectory = getPath('cache/');

module.exports = {
    open,
    defaultCacheDirectory,
    writeString,

    createOutputDist,
    flushOutputDist,
    closeOutputDist
};
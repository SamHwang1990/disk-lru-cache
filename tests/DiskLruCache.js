/**
 * Created by zhiyuan.huang@ddder.net.
 */

'use strict';

const { defaultCacheDirectory, open, writeString } = require('./DiskLruCache.js');
const assert = require('../../utils/assert/index.js');

function simpleTestCase() {
    let directory = defaultCacheDirectory + 'simpleTest/';

    new File(directory).deleteRecursively();


    const diskLruCache = open(directory, 1, 1, 100);

    const key = 'foo';

    assert.equal(diskLruCache.size(), 0);

    let fooSnapshot = diskLruCache.getSnapshot(key);
    assert.deepEqual(fooSnapshot, null);

    let fooEditor = diskLruCache.getEditor(key);
    assert.notEqual(fooEditor, null);

    let fooOutputStream = fooEditor.newOutputStream(0);
    writeString(fooOutputStream, 'hello world');
    fooOutputStream.flush();
    fooEditor.commit();

    assert.equal(diskLruCache.size(), 11);

    fooSnapshot = diskLruCache.getSnapshot(key);
    assert.equal(fooSnapshot.key, key);

    let fooInputStream = fooSnapshot.getInputStream(0);
    assert.equal(fooInputStream.readNextLine(), 'hello world');
    destroyObject(fooInputStream);

    // new Editor from Snapshot
    fooEditor = fooSnapshot.edit();
    assert.notEqual(fooEditor, null);

    // new commit to editor should overwrite the content of clean file
    fooOutputStream = fooEditor.newOutputStream(0);
    writeString(fooOutputStream, 'foo bar');
    fooOutputStream.flush();
    fooEditor.commit();
    assert.equal(diskLruCache.size(), 7);

    // when snapshot is stale, can not allow edit again
    fooEditor = fooSnapshot.edit();
    assert.deepEqual(fooEditor, null);

    // abort editor will simple delete dirty file,
    // nothing change was apply to clean file
    fooEditor = diskLruCache.getEditor(key);
    fooOutputStream = fooEditor.newOutputStream(0);
    writeString(fooOutputStream, 'will abort');
    fooOutputStream.flush();
    fooEditor.abort();
    assert.equal(diskLruCache.size(), 7);

    let barKey = 'bar';
    let barEditor = diskLruCache.getEditor(barKey);
    assert.equal(barEditor.entry.readable, false);
}

function multiCountTestCase() {
    let directory = defaultCacheDirectory + 'multiCountTest/';

    new File(directory).deleteRecursively();
    const diskLruCache = open(directory, 1, 2, 100);

    const fooKey = 'foo';

    // new multi count key shall commit same amount dirty file to value count
    let fooEditor = diskLruCache.getEditor(fooKey);
    try {
        let fooOS1 = fooEditor.newOutputStream(0);
        writeString(fooOS1, 'foo output 1');
        fooOS1.flush();
        fooEditor.commit();
        destroyObject(fooOS1);
    } catch (e) {
        assert.equal(e.message, "edit didn't create file 1");
    } finally {
        assert.equal(fooEditor.entry.currentEditor, null);
    }

    // when editor commit or abort, we shall get editor again
    fooEditor = diskLruCache.getEditor(fooKey);
    const fooOS0 = fooEditor.newOutputStream(0);
    const fooOS1 = fooEditor.newOutputStream(1);
    writeString(fooOS0, 'foo output 0');
    writeString(fooOS1, 'foo output 1');
    fooOS0.flush();
    fooOS1.flush();
    fooEditor.commit();

    assert.equal(diskLruCache.size(), 24);

    let fooSnapshot = diskLruCache.getSnapshot(fooKey);
    let fooIS0 = fooSnapshot.getInputStream(0);
    let fooIS1 = fooSnapshot.getInputStream(1);

    assert.equal(fooIS0.readNextLine(), 'foo output 0');
    assert.equal(fooIS1.readNextLine(), 'foo output 1');

    destroyObject(fooIS0);
    destroyObject(fooIS1);
}

function trimSizeTestCase() {
    let directory = defaultCacheDirectory + 'trimSizeTest/';

    new File(directory).deleteRecursively();
    const diskLruCache = open(directory, 1, 1, 3);

    let k1Editor = diskLruCache.getEditor('k1');
    let k1OutputStream = k1Editor.newOutputStream(0);
    writeString(k1OutputStream, '1');
    k1OutputStream.flush();
    k1Editor.commit();

    let k2Editor = diskLruCache.getEditor('k2');
    let k2OutputStream = k2Editor.newOutputStream(0);
    writeString(k2OutputStream, '1');
    k2OutputStream.flush();
    k2Editor.commit();

    let k3Editor = diskLruCache.getEditor('k3');
    let k3OutputStream = k3Editor.newOutputStream(0);
    writeString(k3OutputStream, '1');
    k3OutputStream.flush();
    k3Editor.commit();

    assert.ok(diskLruCache.size() <= diskLruCache.maxSize());

    let k4Editor = diskLruCache.getEditor('k4');
    let k4OutputStream = k4Editor.newOutputStream(0);
    writeString(k4OutputStream, '1');
    k4OutputStream.flush();
    k4Editor.commit();

    // oldest entry was trim
    assert.equal(diskLruCache.getSnapshot('k1'), null);

    // upgrade last got entry
    let k2Snapshot = diskLruCache.getSnapshot('k2');

    let k5Editor = diskLruCache.getEditor('k5');
    let k5OutputStream = k5Editor.newOutputStream(0);
    writeString(k5OutputStream, '1');
    k5OutputStream.flush();
    k5Editor.commit();

    assert.equal(diskLruCache.getSnapshot('k3'), null);
}

function readFromExistedJournalTestCase() {
    trimSizeTestCase();

    let directory = defaultCacheDirectory + 'trimSizeTest/';

    const diskLruCache = open(directory, 1, 1, 3);

    assert.equal(diskLruCache.getSnapshot('k1'), null);
    assert.equal(diskLruCache.getSnapshot('k2').getInputStream(0).readNextLine(), '1')
    assert.equal(diskLruCache.getSnapshot('k3'), null);
    assert.equal(diskLruCache.getSnapshot('k4').getInputStream(0).readNextLine(), '1')
    assert.equal(diskLruCache.getSnapshot('k5').getInputStream(0).readNextLine(), '1')
}

function concurrentTestCase() {
    let directory = defaultCacheDirectory + 'concurrentTest/';

    new File(directory).deleteRecursively();

    const diskLruCache1 = open(directory, 1, 1, 100);
    const fooEditor1 = diskLruCache1.getEditor('foo');
    const fooOutputStream1 = fooEditor1.newOutputStream(0);
    writeString(fooOutputStream1, 'foo1');
    fooOutputStream1.flush();

    let diskLruCache2 = open(directory, 1, 1, 100);
    let fooEditor2 = diskLruCache2.getEditor('foo');
    assert.equal(fooEditor2, null);

    fooEditor1.commit();

    diskLruCache2 = open(directory, 1, 1, 100);
    fooEditor2 = diskLruCache2.getEditor('foo');
    let fooOutputStream2 = fooEditor2.newOutputStream(0);
    writeString(fooOutputStream2, 'foo22');
    fooOutputStream2.flush();
    fooEditor2.commit();

    assert.equal(diskLruCache2.size(), 5);
    assert.equal(diskLruCache2.getSnapshot('foo').getInputStream(0).readNextLine(), 'foo22');
}

module.exports = {
    init: function() {
        simpleTestCase();
        multiCountTestCase();
        trimSizeTestCase();

        readFromExistedJournalTestCase();

        concurrentTestCase();
    },
    dispose: function() {

    }
}
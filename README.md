# DiskLruCache

参考了android 的[DiskLruCache.java](https://android.googlesource.com/platform/libcore/+/android-4.3_r3/luni/src/main/java/libcore/io/DiskLruCache.java) 后写了一份JS 版本的实现。然后，嫌DiskLruCache 的API 非常繁琐，于是又参考了[ASimpleCache](https://github.com/yangfuhai/ASimpleCache)，增加了一个基于`DiskLruCache.js` 的`FDiskLruCache.js`。

不是一个完备的JS 工具库，单纯从项目中抽取出来的而已。
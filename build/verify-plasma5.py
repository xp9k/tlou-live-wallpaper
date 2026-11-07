"""Run on MOS 12 in its desktop session: python3 verify-plasma5.py PLUGIN OUTPUT.

Exercises the actual Qt 5 renderer and wallpaper shell without changing the
desktop configuration. Also usable with QT_QUICK_BACKEND=software.
"""
import json
import sys
from pathlib import Path

from PyQt5.QtCore import QObject, QUrl, Qt, qInstallMessageHandler
from PyQt5.QtGui import QGuiApplication, QImage
from PyQt5.QtQml import QQmlComponent, QQmlPropertyMap
from PyQt5.QtQuick import QQuickView
from PyQt5.QtTest import QTest


def main():
    plugin = Path(sys.argv[1]).resolve()
    output = Path(sys.argv[2]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    messages = []

    def message_handler(kind, context, message):
        messages.append(message)
        print(message, file=sys.stderr, flush=True)

    qInstallMessageHandler(message_handler)
    app = QGuiApplication(sys.argv)
    config = QQmlPropertyMap()
    defaults = dict(wind=1.0, light=1.0, dust=1.0, quality="eco", fps=15.0,
                    paused=True, autoPause=False, timeMode="manual", hour=13.0, fireflies=24.0)
    for key, value in defaults.items():
        config.insert(key, value)
    wallpaper = QQmlPropertyMap()
    wallpaper.insert("configuration", config)
    view = QQuickView()
    view.setFlags(Qt.Tool | Qt.FramelessWindowHint)
    view.setResizeMode(QQuickView.SizeRootObjectToView)
    view.rootContext().setContextProperty("wallpaper", wallpaper)
    view.resize(640, 360)
    view.setSource(QUrl.fromLocalFile(str(plugin / "contents/ui/main.qml")))
    assert view.status() == QQuickView.Ready, [e.toString() for e in view.errors()]
    view.show()
    QTest.qWait(1500)
    root = view.rootObject()
    scene = next(child for child in root.childItems() if child.metaObject().indexOfProperty("sceneTime") >= 0)

    def frame(name):
        QTest.qWait(350)
        image = view.grabWindow().convertToFormat(QImage.Format_RGBA8888)
        assert not image.isNull()
        image.save(str(output / (name + ".png")))
        bits = image.constBits()
        bits.setsize(image.byteCount())
        data = bytes(bits)
        brightness = (sum(data) - sum(data[3::4])) / (image.width() * image.height() * 765)
        assert brightness > .005, (name, brightness)
        return image, data, brightness

    day = frame("day")
    if scene.property("hardware"):
        background = root.findChild(QObject, "background")
        assert not scene.property("shaderFailed"), background.property("log")
        config.insert("hour", 1.0)
        config.insert("fireflies", 0.0)
        night = frame("night")
        assert night[2] < day[2] * .5, (day[2], night[2])
        config.insert("fireflies", 64.0)
        glow = frame("fireflies")
        assert glow[2] > night[2], (night[2], glow[2])
        config.insert("paused", False)
        QTest.qWait(500)
        before = scene.property("sceneTime")
        QTest.qWait(500)
        assert scene.property("sceneTime") > before
        config.insert("paused", True)
        QTest.qWait(150)
        before = scene.property("sceneTime")
        QTest.qWait(250)
        assert scene.property("sceneTime") == before
        config.insert("autoPause", True)
        config.insert("paused", False)
        cover = QQuickView()
        cover.setTitle("TLOU coverage verification")
        cover.showMaximized()
        QTest.qWait(1200)
        assert root.property("covered"), "Maximized window must pause wallpaper"
        before = scene.property("sceneTime")
        QTest.qWait(250)
        assert scene.property("sceneTime") == before
        cover.showMinimized()
        QTest.qWait(1000)
        assert not root.property("covered"), "Minimized window must release wallpaper"
        QTest.qWait(200)
        assert scene.property("sceneTime") > before
        cover.close()
        config.insert("paused", True)
    else:
        config.insert("paused", False)
        before = scene.property("sceneTime")
        QTest.qWait(300)
        assert scene.property("sceneTime") == before
    view.resize(360, 640)
    portrait = frame("portrait")
    assert portrait[0].width() == 360 and portrait[0].height() == 640
    component = QQmlComponent(view.engine(), QUrl.fromLocalFile(str(plugin / "contents/ui/config.qml")))
    settings = component.create()
    assert settings is not None, [e.toString() for e in component.errors()]
    settings.setProperty("cfg_hour", 21.5)
    settings.setProperty("cfg_quality", "high")
    assert settings.property("cfg_hour") == 21.5
    errors = [m for m in messages if any(word in m for word in
              ("Error", "is not installed", "is not defined", "Cannot assign", "shader compilation failed"))]
    assert not errors, errors
    result = {"passed": True, "hardwareBackend": scene.property("hardware"), "dayBrightness": day[2]}
    (output / "results.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result), flush=True)
    settings.deleteLater()
    view.close()
    # Destroy QML while its injected wallpaper/configuration objects still live.
    view.setSource(QUrl())
    app.processEvents()


if __name__ == "__main__":
    main()

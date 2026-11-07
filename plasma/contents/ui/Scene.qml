import QtQuick
import QtQuick.Window
import "SceneConfig.js" as Settings

Item {
    id: scene
    clip: true
    property real wind: Settings.defaults.wind
    property real light: Settings.defaults.light
    property real dust: Settings.defaults.dust
    property string quality: Settings.defaults.quality
    property real fps: Settings.defaults.fps
    property bool paused: false
    property string timeMode: Settings.defaults.timeMode
    property real hour: Settings.defaults.hour
    property real fireflies: Settings.defaults.fireflies
    property real clockHour: Settings.defaults.hour
    readonly property real currentHour: timeMode === "manual"
        ? Math.max(0, Math.min(24, hour)) : clockHour
    property real sceneTime: Settings.defaults.time
    readonly property int particles: Settings.particleCounts[quality] || Settings.particleCounts.ultra
    readonly property real aspect: plate.sourceSize.width / Math.max(1, plate.sourceSize.height)
    readonly property real cropX: Math.min(1, width / Math.max(1, height) / aspect)
    readonly property real cropY: Math.min(1, aspect / (width / Math.max(1, height)))
    readonly property bool texturesReady: plate.status === Image.Ready && masks.status === Image.Ready
        && illumination.status === Image.Ready && seeds.status === Image.Ready
    readonly property bool hardware: GraphicsInfo.api !== GraphicsInfo.Software
    readonly property real renderScale: Math.min(1, Math.sqrt(
        (Settings.pixelLimits[quality] || Settings.pixelLimits.ultra)
        / Math.max(1, width * height * Screen.devicePixelRatio * Screen.devicePixelRatio)))

    Timer {
        id: clock
        property double previous: 0
        interval: Math.max(1, Math.round(1000 / Math.max(15, Math.min(scene.quality === "eco" ? 30 : 120, scene.fps))))
        repeat: true
        running: scene.visible && !scene.paused && scene.texturesReady && scene.hardware
        onRunningChanged: previous = 0
        onTriggered: {
            const now = Date.now();
            if (previous) scene.sceneTime += Math.min((now - previous) / 1000, 0.1);
            previous = now;
        }
    }

    // Local clock for the automatic time of day; runs while paused as well,
    // so a still frame follows the time. One update per minute.
    Timer {
        interval: 60000
        repeat: true
        triggeredOnStart: true
        running: scene.timeMode !== "manual"
        onTriggered: {
            const now = new Date();
            scene.clockHour = now.getHours() + now.getMinutes() / 60;
        }
    }

    Image { id: plate; source: "../images/plate.png"; visible: false }
    Image { id: masks; source: "../images/masks.png"; visible: false }
    Image { id: illumination; source: "../images/illumination.png"; visible: false }
    Image { id: seeds; source: "../images/seeds.png"; visible: false; smooth: false }

    Rectangle { anchors.fill: parent; color: "#11130d" }
    Image {
        source: plate.source
        width: Math.max(scene.width, scene.height * scene.aspect)
        height: width / scene.aspect
        x: (scene.width - width) * 0.66
        y: (scene.height - height) * 0.5
        visible: !scene.hardware || background.status === ShaderEffect.Error || !scene.texturesReady
    }

    Item {
        id: render
        objectName: "render"
        anchors.fill: parent
        visible: scene.hardware && scene.texturesReady && background.status !== ShaderEffect.Error
        layer.enabled: true
        layer.smooth: true
        layer.textureSize: Qt.size(Math.max(1, Math.round(width * Screen.devicePixelRatio * scene.renderScale)),
            Math.max(1, Math.round(height * Screen.devicePixelRatio * scene.renderScale)))

        ShaderEffect {
            id: background
            objectName: "background"
            anchors.fill: parent
            blending: false
            property var uImage: plate
            property var uMasks: masks
            property var uIllumination: illumination
            property vector2d uCover: Qt.vector2d(scene.cropX, scene.cropY)
            property vector2d uOffset: Qt.vector2d((1 - scene.cropX) * 0.66, (1 - scene.cropY) * 0.5)
            property vector2d uResolution: Qt.vector2d(width, height)
            property real uTime: scene.sceneTime
            property real uWind: scene.wind
            property real uLight: scene.light
            property real uScale: height / 1080
            property real uDust: scene.dust
            property real uParticleCount: scene.particles
            property real uSeedCount: Settings.particleCounts.ultra
            property real uHour: scene.currentHour
            fragmentShader: "../shaders/scene.frag.qsb"
            onStatusChanged: if (status === ShaderEffect.Error) console.warn("TLOU scene:", log)
        }

        ShaderEffect {
            anchors.fill: parent
            visible: scene.dust > 0 && background.status !== ShaderEffect.Error
            property var uSeeds: seeds
            property vector2d uCover: background.uCover
            property vector2d uOffset: background.uOffset
            property vector2d uResolution: background.uResolution
            property real uTime: background.uTime
            property real uWind: background.uWind
            property real uLight: background.uLight
            property real uScale: background.uScale
            property real uDust: background.uDust
            property real uParticleCount: background.uParticleCount
            property real uSeedCount: background.uSeedCount
            property real uHour: background.uHour
            mesh: GridMesh { resolution: Qt.size(scene.particles * 4 - 1, 1) }
            vertexShader: "../shaders/dust.vert.qsb"
            fragmentShader: "../shaders/dust.frag.qsb"
            onStatusChanged: if (status === ShaderEffect.Error) console.warn("TLOU dust:", log)
        }

        ShaderEffect {
            id: fireflies
            readonly property int count: Math.max(0, Math.min(64, Math.round(scene.fireflies)))
            anchors.fill: parent
            visible: count > 0 && background.status !== ShaderEffect.Error
            property var uSeeds: seeds
            property vector2d uCover: background.uCover
            property vector2d uOffset: background.uOffset
            property vector2d uResolution: background.uResolution
            property real uTime: background.uTime
            property real uWind: background.uWind
            property real uLight: background.uLight
            property real uScale: background.uScale
            property real uDust: background.uDust
            property real uHour: background.uHour
            property real uParticleCount: count
            property real uSeedCount: background.uSeedCount
            mesh: GridMesh { resolution: Qt.size(Math.max(1, fireflies.count) * 4 - 1, 1) }
            vertexShader: "../shaders/firefly.vert.qsb"
            fragmentShader: "../shaders/firefly.frag.qsb"
            onStatusChanged: if (status === ShaderEffect.Error) console.warn("TLOU fireflies:", log)
        }
    }

}

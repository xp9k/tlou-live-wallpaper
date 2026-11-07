'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Qt 5 uses GLSL source strings and individual uniforms. Keep all effect
// calculations and the particle mesh identical to the Qt 6 generator.
function shadersForQt5(shaders) {
  return Object.fromEntries(Object.entries(shaders).map(([name, source]) => {
    const vertex = name.endsWith('.vert');
    const shader = source.replace('#version 440', '#ifdef GL_ES\nprecision highp float;\n#endif')
      .replace(/layout\(std140, binding=0\) uniform buf \{([\s\S]*?)\};/, (_, fields) =>
        fields.trim().split('\n').map(field => 'uniform ' + field.trim()).join('\n'))
      .replace(/layout\(binding=\d+\) uniform/g, 'uniform')
      .replace(/layout\(location=\d+\) (in|out) ([^;]+);/g, (_, direction, declaration) => {
        if (!vertex && direction === 'out') return '';
        return (vertex && direction === 'in' ? 'attribute' : 'varying') + ' ' + declaration + ';';
      })
      .replaceAll('fragColor', 'gl_FragColor').replaceAll('texture(', 'texture2D(');
    return [name.replaceAll('.', '_'), shader];
  }));
}

function preparePlasma5(source, destination, shaders) {
  fs.cpSync(source, destination, {recursive:true});
  const ui = path.join(destination, 'contents/ui');
  for (const name of ['main.qml', 'Scene.qml', 'config.qml']) {
    const file = path.join(ui, name);
    let qml = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n')
      .replace(/^import QtQuick$/m, 'import QtQuick 2.15')
      .replace(/^import QtQuick.Window$/m, 'import QtQuick.Window 2.15')
      .replace(/^import QtQuick.Controls$/m, 'import QtQuick.Controls 2.15')
      .replace(/^import QtQuick.Layouts$/m, 'import QtQuick.Layouts 1.15');
    if (name === 'main.qml') {
      qml = qml.replace('import org.kde.plasma.plasmoid\n', '')
        .replace('import org.kde.taskmanager as TaskManager', 'import org.kde.taskmanager 0.1 as TaskManager')
        .replace('WallpaperItem {\n    id: wallpaper', 'Item {\n    id: root')
        .replaceAll('wallpaper.covered', 'root.covered')
        .replaceAll('wallpaper.updateCovered', 'root.updateCovered')
        .replaceAll('wallpaper.Screen', 'root.Screen');
    }
    if (name === 'Scene.qml') {
      qml = qml.replace('import "SceneConfig.js" as Settings', 'import "SceneConfig.js" as Settings\nimport "ShaderSources.js" as Shaders')
        // On the MOS Qt 5 build status remains Error even for a rendered
        // shader. Use the compilation log so that valid effects stay visible.
        .replace('id: scene', 'id: scene\n    readonly property bool shaderFailed: /error|failed/i.test(background.log)')
        .replaceAll('background.status === ShaderEffect.Error', 'scene.shaderFailed')
        .replaceAll('background.status !== ShaderEffect.Error', '!scene.shaderFailed')
        .replaceAll('if (status === ShaderEffect.Error)', 'if (/error|failed/i.test(log))')
        .replace(/"\.\.\/shaders\/([\w.]+)\.qsb"/g, (_, shader) => 'Shaders.' + shader.replaceAll('.', '_'));
    }
    fs.writeFileSync(file, qml);
  }
  const shaderDirectory = path.join(destination, 'contents/shaders');
  fs.rmSync(shaderDirectory, {recursive:true, force:true});
  fs.writeFileSync(path.join(ui, 'ShaderSources.js'), '.pragma library\n' +
    Object.entries(shadersForQt5(shaders)).map(([name, shader]) => `var ${name} = ${JSON.stringify(shader)};\n`).join(''));
  const metadataPath = path.join(destination, 'metadata.json');
  const metadata = JSON.parse(fs.readFileSync(metadataPath));
  metadata['X-Plasma-API-Minimum-Version'] = '5.27';
  metadata['X-Plasma-API'] = 'declarativeappletscript';
  metadata['X-Plasma-MainScript'] = 'ui/main.qml';
  metadata.KPlugin.ServiceTypes = ['Plasma/Wallpaper'];
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
}
module.exports = {preparePlasma5, shadersForQt5};

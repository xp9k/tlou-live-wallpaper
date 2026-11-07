%global wallpaper_id org.tlou.stillalive

Name:           tlou-wallpaper
Version:        1.0.0
Release:        1%{?dist}
Summary:        TLOU - Live Wallpaper: animated wallpaper for KDE Plasma 5
Summary(ru):    TLOU - Live Wallpaper: живые обои для KDE Plasma 5
License:        LicenseRef-Unknown
URL:            https://github.com/xp9k/tlou-live-wallpaper
Source0:        %{name}-%{version}.tar.gz
BuildArch:      noarch
Requires:       plasma5-workspace >= 5.27
Requires:       qt5-qtdeclarative >= 5.15
Requires:       qml(org.kde.taskmanager)
Requires:       lib64qt5-qtquick-qml >= 5.15
Requires:       lib64qt5-qtquickcontrols2-qml >= 5.15
AutoReqProv:    no

%description
TLOU - Live Wallpaper is a living wallpaper for KDE Plasma 5 by xp9k.
A quiet abandoned room: sunlight through an old window, curtains and ivy
moving in a light wind, dust drifting in the light.

The scene is rendered natively by Qt Quick inside Plasma using prepared
images and GLSL shaders for Qt 5. No web browser, web server, Node.js or
external wallpaper player is needed. Time of day, wind, light, dust amount,
quality, frame rate, firefly count and pause are configurable in the desktop
settings. Lighting follows the local clock by default: sunlight by day, warm
low rays in the morning and evening, cold moonlight and fireflies outside
the window at night.
The animation pauses automatically while a maximized or fullscreen window
covers the screen.

The wallpaper is installed system-wide as the Plasma wallpaper plugin
%{wallpaper_id}.

Fan-made work inspired by The Last of Us. Not affiliated with or endorsed by
Naughty Dog or Sony Interactive Entertainment.

%description -l ru
TLOU - Live Wallpaper - живые обои для KDE Plasma 5, автор xp9k.
Тихая заброшенная комната: солнечный свет из старого окна, шторы и плющ
слегка движутся на ветру, в лучах света плывёт пыль.

Сцена отрисовывается внутри Plasma штатными средствами Qt Quick из
подготовленных изображений и GLSL-шейдеров Qt 5. Браузер,
веб-сервер, Node.js и внешний проигрыватель обоев не нужны. В настройках
рабочего стола доступны время суток, ветер, свет, количество пыли,
качество, частота кадров и пауза. Освещение по умолчанию следует
часам компьютера: днём солнце, утром и вечером тёплые лучи, ночью лунный
полумрак и светлячки за окном. Анимация автоматически останавливается, пока
экран закрыт развёрнутым или полноэкранным окном.

Обои устанавливаются для всех пользователей как модуль Plasma
%{wallpaper_id}.

Фанатская работа по мотивам The Last of Us. Не связана с Naughty Dog и
Sony Interactive Entertainment и не одобрена ими.

%prep
%setup -q

%build
# Images and GLSL shader sources are prepared in Source0 by the local
# build script. This data-only RPM does not compile architecture-specific code.

%install
install -d %{buildroot}%{_datadir}/plasma/wallpapers/%{wallpaper_id}
cp -a %{wallpaper_id}/. %{buildroot}%{_datadir}/plasma/wallpapers/%{wallpaper_id}/
find %{buildroot}%{_datadir}/plasma/wallpapers/%{wallpaper_id} -type d -exec chmod 0755 {} +
find %{buildroot}%{_datadir}/plasma/wallpapers/%{wallpaper_id} -type f -exec chmod 0644 {} +

%check
test -s %{buildroot}%{_datadir}/plasma/wallpapers/%{wallpaper_id}/metadata.json
test -s %{buildroot}%{_datadir}/plasma/wallpapers/%{wallpaper_id}/contents/ui/main.qml
test -s %{buildroot}%{_datadir}/plasma/wallpapers/%{wallpaper_id}/contents/ui/ShaderSources.js
test -s %{buildroot}%{_datadir}/plasma/wallpapers/%{wallpaper_id}/contents/images/plate.png

%files
%defattr(-,root,root,-)
%doc README.mos12.md settings.png
%{_datadir}/plasma/wallpapers/%{wallpaper_id}/

%changelog
* Sat Nov 07 2026 xp9k (https://github.com/xp9k) - 1.0.0-1
- Initial release: native Qt Quick wallpaper for MOS 12 / KDE Plasma 5.

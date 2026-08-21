import type { ExternalPluginConfig } from '@windy/interfaces';

const config: ExternalPluginConfig = {
    name: 'windy-plugin-stormtracker',
    version: '1.6.0',
    icon: '⛈️',
    title: 'StormTracker',
    description: 'Real-time radar-based storm cell detection with movement arrows, track cones, and observed lightning (NOAA GOES GLM). Powered by RainViewer & NEXRAD.',
    author: 'CAPFlyingFun',
    repository: 'https://github.com/CAPFlyingFun/StormTracker-Windy-Plugin',
    desktopUI: 'rhpane',
    // v1.5.0: 'small' — on phones the plugin renders as a compact bottom
    // sheet with the map still visible, instead of a fullscreen takeover
    // (which hid the map entirely and swiped closed when users tried to
    // shrink it).
    mobileUI: 'small',
    desktopWidth: 320,
    routerPath: '/stormtracker',
    private: true,
};

export default config;

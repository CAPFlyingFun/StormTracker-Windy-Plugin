import type { ExternalPluginConfig } from '@windy/interfaces';

const config: ExternalPluginConfig = {
    name: 'windy-plugin-stormtracker',
    version: '1.4.0',
    icon: '⛈️',
    title: 'StormTracker',
    description: 'Real-time radar-based storm cell detection with movement arrows, track cones, and observed lightning (NOAA GOES GLM). Powered by RainViewer & NEXRAD.',
    author: 'CAPFlyingFun',
    repository: 'https://github.com/CAPFlyingFun/StormTracker-Windy-Plugin',
    desktopUI: 'rhpane',
    mobileUI: 'fullscreen',
    desktopWidth: 320,
    routerPath: '/stormtracker',
    private: true,
};

export default config;

import { Platform } from 'react-native';
import { getDeviceType, isTablet as checkIsTablet } from 'react-native-device-info';

const isTablet: boolean = checkIsTablet();
const isDesktop: boolean = getDeviceType() === 'Desktop';

/**
 * iOS 26 sets every navigation bar item on a Liquid Glass capsule of its own, so a header button
 * that also paints a background ends up as a shape inside a shape. Header buttons draw only their
 * glyph when this is true.
 */
const hasLiquidGlass: boolean = Platform.OS === 'ios' && parseInt(String(Platform.Version), 10) >= 26;

export { hasLiquidGlass, isDesktop, isTablet };

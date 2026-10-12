import React from 'react';
import { Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';

import { ClashFont } from '../constants/fonts';
import loc from '../loc';
import { getEffectiveTheme } from './themes';

type ErrorBoundaryProps = { children: React.ReactNode };
type ErrorBoundaryState = { hasError: boolean };

// Sits above the providers and NavigationContainer, so it can't read the user's theme setting or
// useTheme(); it follows the OS color scheme instead.
const CrashScreen = ({ onRetry }: { onRetry: () => void }) => {
  const { colors } = getEffectiveTheme('system', useColorScheme());

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]} testID="CrashScreen">
      <Text style={[styles.title, { color: colors.text }]}>{loc.errors.crash_title}</Text>
      <Text style={[styles.message, { color: colors.textSecondary }]}>{loc.errors.crash_message}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        style={[styles.button, { backgroundColor: colors.brandPrimary }]}
        testID="CrashRetryButton"
      >
        <Text style={[styles.buttonText, { color: colors.white }]}>{loc.errors.crash_retry}</Text>
      </Pressable>
    </View>
  );
};

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  // Remounts the whole tree, which lands back on UnlockWith. startAndDecrypt skips reloading
  // because the ShroudApp singleton still holds the wallets, and providers re-attach callbacks.
  retry = () => this.setState({ hasError: false });

  render() {
    if (this.state.hasError) return <CrashScreen onRetry={this.retry} />;
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontFamily: ClashFont.semibold,
    fontSize: 22,
    marginBottom: 12,
  },
  message: {
    fontFamily: ClashFont.regular,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 32,
  },
  button: {
    alignItems: 'center',
    borderRadius: 12,
    paddingVertical: 16,
  },
  buttonText: {
    fontFamily: ClashFont.semibold,
    fontSize: 16,
  },
});

import React, { forwardRef, useImperativeHandle, useRef, ReactElement, ComponentType } from 'react';
import { TrueSheet, TrueSheetProps } from '@lodev09/react-native-true-sheet';
import { Keyboard, Image, StyleSheet, View, Pressable, Platform, GestureResponderEvent, Text, StyleProp, ViewStyle } from 'react-native';
import SaveFileButton from './SaveFileButton';
import { useTheme } from './themes';
import { Icon } from '@rneui/base';

// BottomModal renders its own header and footer, so TrueSheet's props of the same name are replaced.
interface BottomModalProps extends Omit<TrueSheetProps, 'header' | 'footer'> {
  children?: React.ReactNode;
  onClose?: () => void;
  onCloseModalPressed?: () => Promise<void>;
  isGrabberVisible?: boolean;
  footer?: ReactElement | ComponentType<any> | null;
  footerDefaultMargins?: boolean | number;
  onPresent?: () => void;
  showCloseButton?: boolean;
  shareContent?: BottomModalShareContent;
  shareButtonOnPress?: (event: GestureResponderEvent) => void;
  header?: ReactElement | ComponentType<any> | null;
  headerTitle?: string;
  headerSubtitle?: string;
  /** Overrides the default children padding, for sheets that draw their own header. */
  contentStyle?: StyleProp<ViewStyle>;
}

type BottomModalShareContent = {
  fileName: string;
  fileContent: string;
};

export interface BottomModalHandle {
  present: () => Promise<void>;
  dismiss: () => Promise<void>;
}

const BottomModal = forwardRef<BottomModalHandle, BottomModalProps>(
  (
    {
      onClose,
      onCloseModalPressed,
      onPresent,
      showCloseButton = true,
      isGrabberVisible = true,
      shareContent,
      shareButtonOnPress,
      detents = ['auto'],
      footer,
      footerDefaultMargins,
      header,
      headerTitle,
      headerSubtitle,
      contentStyle,
      children,
      ...props
    },
    ref,
  ) => {
    const trueSheetRef = useRef<TrueSheet>(null);
    const { colors, closeImage } = useTheme();
    const stylesHook = StyleSheet.create({
      barButton: {
        backgroundColor: colors.surfaceSubtle,
      },
      headerTitle: {
        color: colors.textSecondary,
      },
    });

    useImperativeHandle(ref, () => ({
      present: async () => {
        Keyboard.dismiss();
        if (trueSheetRef.current?.present) {
          await trueSheetRef.current.present();
        } else {
          return Promise.resolve();
        }
      },
      dismiss: async () => {
        Keyboard.dismiss();
        if (trueSheetRef.current?.dismiss) {
          await trueSheetRef.current.dismiss();
        } else {
          return Promise.resolve();
        }
      },
    }));

    const dismiss = async () => {
      try {
        await onCloseModalPressed?.();
        await trueSheetRef.current?.dismiss();
      } catch (error) {
        console.error('Error during dismiss:', error);
      }
    };

    const renderTopRightButton = () => {
      const buttons = [];
      if (shareContent || shareButtonOnPress) {
        if (shareContent) {
          buttons.push(
            <SaveFileButton
              style={[styles.topRightButton, stylesHook.barButton]}
              fileContent={shareContent.fileContent}
              fileName={shareContent.fileName}
              testID="ModalShareButton"
              key="ModalShareButton"
            >
              <Icon name={Platform.OS === 'android' ? 'share' : 'file-upload'} type="font-awesome6" size={20} color={colors.white} />
            </SaveFileButton>,
          );
        } else if (shareButtonOnPress) {
          buttons.push(
            <Pressable
              testID="ModalShareButton"
              key="ModalShareButton"
              style={({ pressed }) => [pressed && styles.pressed, styles.topRightButton, stylesHook.barButton]}
              onPress={shareButtonOnPress}
            >
              <Icon name={Platform.OS === 'android' ? 'share' : 'file-upload'} type="font-awesome6" size={20} color={colors.white} />
            </Pressable>,
          );
        }
      }
      if (showCloseButton) {
        buttons.push(
          <Pressable
            style={({ pressed }) => [pressed && styles.pressed, styles.topRightButton, stylesHook.barButton]}
            onPress={dismiss}
            key="ModalDoneButton"
            testID="ModalDoneButton"
          >
            <Image source={closeImage} />
          </Pressable>,
        );
      }
      return <View style={styles.topRightButtonContainer}>{buttons}</View>;
    };

    const renderHeader = () => {
      if (headerTitle || headerSubtitle) {
        return (
          <View style={styles.headerContainer}>
            <View style={styles.headerContent}>
              {headerTitle && <Text style={[styles.headerTitle, stylesHook.headerTitle]}>{headerTitle}</Text>}
              {headerSubtitle && <Text style={[styles.headerSubtitle, stylesHook.headerTitle]}>{headerSubtitle}</Text>}
            </View>
            {renderTopRightButton()}
          </View>
        );
      }

      if (showCloseButton || shareContent)
        return (
          <View style={styles.headerContainer}>
            <View style={styles.headerContent}>{typeof header === 'function' ? <header /> : header}</View>
            {renderTopRightButton()}
          </View>
        );

      if (React.isValidElement(header)) {
        return (
          <View style={styles.headerContainerWithCloseButton}>
            {header}
            {renderTopRightButton()}
          </View>
        );
      }
      return null;
    };

    const renderFooter = (): ReactElement | undefined => {
      if (React.isValidElement(footer)) {
        return footerDefaultMargins ? <View style={styles.footerContainer}>{footer}</View> : footer;
      } else if (typeof footer === 'function') {
        const ModalFooterComponent = footer as ComponentType<any>;
        return <ModalFooterComponent />;
      }

      return undefined;
    };

    const FooterComponent = renderFooter();

    return (
      <TrueSheet
        ref={trueSheetRef}
        detents={detents}
        onDidDismiss={onClose}
        onDidPresent={onPresent}
        grabber={isGrabberVisible}
        footer={FooterComponent}
        {...props}
      >
        <View style={[styles.childrenContainer, contentStyle]}>{children}</View>
        {renderHeader()}
      </TrueSheet>
    );
  },
);

export default BottomModal;

const styles = StyleSheet.create({
  footerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerContainer: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    minHeight: 22,
    right: 16,
    top: 16,
  },
  headerContainerWithCloseButton: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    minHeight: 22,
    width: '100%',
    top: 16,
    left: 0,
    justifyContent: 'space-between',
  },
  headerContent: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 22,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerSubtitle: {
    fontSize: 14,
  },
  topRightButton: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 30,
    height: 30,
    borderRadius: 15,
    marginLeft: 22,
  },
  topRightButtonContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  childrenContainer: {
    paddingTop: 66,
    paddingHorizontal: 16,
    width: '100%',
  },
  pressed: {
    opacity: 0.6,
  },
});

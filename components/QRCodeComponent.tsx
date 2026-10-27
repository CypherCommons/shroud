import Clipboard from '@react-native-clipboard/clipboard';
import React, { useCallback, useRef } from 'react';
import { ImageSourcePropType, Platform, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import Share from 'react-native-share';

import loc from '../loc';
import ToolTipMenu from './TooltipMenu';
import CopyIcon from './icons/CopyIcon';
import ShareIcon from './icons/ShareIcon';
import { Action } from './types';

interface QRCodeComponentProps {
  value: string;
  isMenuAvailable?: boolean;
  size?: number;
  ecl?: 'H' | 'Q' | 'M' | 'L';
  onError?: () => void;
  logo?: ImageSourcePropType;
  logoSize?: number;
  logoBackgroundColor?: string;
  logoBorderRadius?: number;
}

const actionKeys = {
  Share: 'share',
  Copy: 'copy',
};

const menuActions: Action[] =
  Platform.OS === 'ios' || Platform.OS === 'macos'
    ? [
        {
          id: actionKeys.Copy,
          text: loc.transactions.details_copy,
          icon: CopyIcon,
        },
        { id: actionKeys.Share, text: loc.receive.details_share, icon: ShareIcon },
      ]
    : [
        {
          id: actionKeys.Copy,
          text: loc.transactions.details_copy,
          icon: CopyIcon,
        },
      ];

const QRCodeComponent: React.FC<QRCodeComponentProps> = ({
  value = '',
  isMenuAvailable = true,
  size = 300,
  ecl = 'H',
  onError = () => {},
  logo,
  logoSize,
  logoBackgroundColor,
  logoBorderRadius,
}) => {
  const qrCode = useRef<{ toDataURL: (callback: (data: string) => void) => void } | null>(null);
  // getRef is a plain ref (react-native-qrcode-svg forwards it to `ref={getRef}` on the
  // underlying SVG), so an inline function here would be torn down and reattached on every
  // render — this memoizes it, matching what DynamicQRCode's 500ms re-render cycle needs.
  const setQrCodeRef = useCallback((c: { toDataURL: (callback: (data: string) => void) => void } | null) => {
    qrCode.current = c;
  }, []);

  const handleShareQRCode = () => {
    if (!qrCode.current) return;
    qrCode.current.toDataURL((data: string) => {
      data = data.replace(/(\r\n|\n|\r)/gm, '');
      const shareImageBase64 = {
        url: `data:image/png;base64,${data}`,
      };
      Share.open(shareImageBase64).catch((error: Error) => console.log(error));
    });
  };

  const onPressMenuItem = useCallback((id: string) => {
    if (id === actionKeys.Share) {
      handleShareQRCode();
    } else if (id === actionKeys.Copy) {
      if (!qrCode.current) return;
      qrCode.current.toDataURL(Clipboard.setImage);
    }
  }, []);

  const renderQRCode = (
    <QRCode
      value={value}
      size={size}
      color="#000000"
      backgroundColor="#FFFFFF"
      quietZone={Math.round(size * 0.08)}
      ecl={ecl}
      getRef={setQrCodeRef}
      onError={onError}
      {...(logo ? { logo, logoSize, logoBackgroundColor, logoBorderRadius } : {})}
    />
  );

  return (
    <View
      testID="BitcoinAddressQRCodeContainer"
      accessibilityIgnoresInvertColors
      importantForAccessibility="no-hide-descendants"
      accessibilityRole="image"
      accessibilityLabel={loc.receive.qrcode_for_the_address}
    >
      {isMenuAvailable ? (
        <ToolTipMenu actions={menuActions} onPressMenuItem={onPressMenuItem}>
          {renderQRCode}
        </ToolTipMenu>
      ) : (
        renderQRCode
      )}
    </View>
  );
};

export default QRCodeComponent;

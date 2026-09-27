import React, { useMemo } from 'react';
import { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import navigationStyle, { CloseButtonPosition } from '../components/navigationStyle';
import { useTheme } from '../components/themes';
import loc from '../loc';
import Broadcast from '../screen/send/Broadcast';
import Success from '../screen/send/success';
import CPFP from '../screen/transactions/CPFP';
import TransactionDetails from '../screen/transactions/TransactionDetails';
import RBFBumpFee from '../screen/transactions/RBFBumpFee';
import RBFCancel from '../screen/transactions/RBFCancel';
import WalletsList from '../screen/wallets/WalletsList';
import { DetailViewStack } from './index';
import SettingsButton from '../components/icons/SettingsButton';
import { ShroudApp } from '../class';
import Settings from '../screen/settings/Settings';
import Currency from '../screen/settings/Currency';
import GeneralSettings from '../screen/settings/GeneralSettings';
import ThemeSettings from '../screen/settings/ThemeSettings';
import DenominationSettings from '../screen/settings/DenominationSettings';
import Licensing from '../screen/settings/Licensing';
import About from '../screen/settings/About';
import ElectrumServerSettings from '../screen/settings/ElectrumServerSettings';
import BlockExplorerSettings from '../screen/settings/BlockExplorerSettings';
import TorSettings from '../screen/settings/TorSettings';
import NetworkSettings from '../screen/settings/NetworkSettings';
import Security from '../screen/settings/Security';
import ChangePin from '../screen/settings/ChangePin';
import ViewRecoveryPhrase from '../screen/settings/ViewRecoveryPhrase';
import PlausibleDeniability from '../screen/PlausibleDeniability';

import { useSizeClass, SizeClass } from '../modules/sizeClass';
import { isDesktop } from '../modules/environment';
import ReceiveDetails from '../screen/receive/ReceiveDetails';
import TrackPayment from '../screen/wallets/TrackPayment';
import PaymentFound from '../screen/wallets/PaymentFound';
import NoPaymentFound from '../screen/wallets/NoPaymentFound';
import SyncScreen from '../screen/wallets/SyncScreen';
import OnboardingStack from './OnboardingStack';
import ContactList from '../screen/contacts/ContactList';
import ContactEdit from '../screen/contacts/ContactEdit';
import ContactDetail from '../screen/contacts/ContactDetail';

const DetailViewStackScreensStack = () => {
  const theme = useTheme();
  const { sizeClass } = useSizeClass();
  const RightBarButtons = useMemo(() => <SettingsButton />, []);

  const walletListScreenOptions = useMemo<NativeStackNavigationOptions>(() => {
    return {
      title: '',
      navigationBarColor: theme.colors.background,
      headerLargeTitle: sizeClass === SizeClass.Compact,
      headerShadowVisible: false,
      headerRight: () => (isDesktop ? undefined : RightBarButtons),
    };
  }, [RightBarButtons, sizeClass, theme.colors.background]);

  // Derive the initial route from the ShroudApp singleton (populated synchronously by
  // startAndDecrypt before walletsInitialized flips) rather than the React `wallets` state,
  // which lags one render behind on launch and would otherwise pin us to Onboarding even
  // when a wallet exists. initialRouteName is only read once at navigator mount.
  const initialRoute = ShroudApp.getInstance().getWallets().length === 0 ? 'Onboarding' : 'WalletsList';

  return (
    <DetailViewStack.Navigator
      initialRouteName={initialRoute}
      screenOptions={{ headerShadowVisible: false, animationTypeForReplace: 'push' }}
    >
      <DetailViewStack.Screen
        name="Onboarding"
        component={OnboardingStack}
        options={{ headerShown: false, gestureEnabled: false, headerBackVisible: false }}
      />
      <DetailViewStack.Screen name="WalletsList" component={WalletsList} options={navigationStyle(walletListScreenOptions)(theme)} />
      <DetailViewStack.Screen
        name="TransactionDetails"
        component={TransactionDetails}
        options={navigationStyle({
          statusBarStyle: 'auto',
          headerTitle: loc.transactions.details_title,
        })(theme)}
      />
      <DetailViewStack.Screen name="CPFP" component={CPFP} options={navigationStyle({ title: loc.transactions.cpfp_title })(theme)} />
      <DetailViewStack.Screen
        name="RBFBumpFee"
        component={RBFBumpFee}
        options={navigationStyle({ title: loc.transactions.rbf_title })(theme)}
      />
      <DetailViewStack.Screen
        name="RBFCancel"
        component={RBFCancel}
        options={navigationStyle({ title: loc.transactions.cancel_title })(theme)}
      />
      <DetailViewStack.Screen
        name="Broadcast"
        component={Broadcast}
        options={navigationStyle({ title: loc.send.create_broadcast })(theme)}
      />
      <DetailViewStack.Screen
        name="Success"
        component={Success}
        options={{
          headerShown: false,
          gestureEnabled: false,
        }}
      />
      <DetailViewStack.Screen name="Settings" component={Settings} options={navigationStyle({ title: loc.settings.header })(theme)} />
      <DetailViewStack.Screen name="Currency" component={Currency} options={navigationStyle({ title: loc.settings.currency })(theme)} />
      <DetailViewStack.Screen name="Contacts" component={ContactList} options={navigationStyle({ title: loc.contacts.header })(theme)} />
      <DetailViewStack.Screen
        name="ContactEdit"
        component={ContactEdit}
        options={navigationStyle({ title: loc.contacts.add_header })(theme)}
      />
      <DetailViewStack.Screen
        name="General"
        component={GeneralSettings}
        options={navigationStyle({ title: loc.settings.general })(theme)}
      />
      <DetailViewStack.Screen
        name="ThemeSettings"
        component={ThemeSettings}
        options={navigationStyle({ title: loc.settings.theme })(theme)}
      />
      <DetailViewStack.Screen
        name="DenominationSettings"
        component={DenominationSettings}
        options={navigationStyle({ title: loc.settings.denomination })(theme)}
      />
      <DetailViewStack.Screen
        name="ContactDetail"
        component={ContactDetail}
        options={navigationStyle({ title: loc.contacts.header })(theme)}
      />
      <DetailViewStack.Screen name="Licensing" component={Licensing} options={navigationStyle({ title: loc.settings.license })(theme)} />
      <DetailViewStack.Screen name="About" component={About} options={navigationStyle({ title: loc.settings.about })(theme)} />
      <DetailViewStack.Screen
        name="ElectrumServerSettings"
        component={ElectrumServerSettings}
        options={navigationStyle({ title: loc.settings.electrum_settings_server })(theme)}
        initialParams={{ server: undefined }}
      />
      <DetailViewStack.Screen
        name="BlockExplorerSettings"
        component={BlockExplorerSettings}
        options={navigationStyle({ title: loc.settings.block_explorer_title })(theme)}
      />
      <DetailViewStack.Screen
        name="TorSettings"
        component={TorSettings}
        options={navigationStyle({ title: loc.settings.tor_title })(theme)}
      />
      <DetailViewStack.Screen
        name="NetworkSettings"
        component={NetworkSettings}
        options={navigationStyle({ title: loc.settings.network })(theme)}
      />
      <DetailViewStack.Screen
        name="Security"
        component={Security}
        options={navigationStyle({ title: loc.settings.security_title })(theme)}
      />
      <DetailViewStack.Screen
        name="ChangePin"
        component={ChangePin}
        options={navigationStyle({ title: loc.settings.security_change_your_pin })(theme)}
      />
      <DetailViewStack.Screen name="ViewRecoveryPhrase" component={ViewRecoveryPhrase} options={{ headerShown: false }} />
      <DetailViewStack.Screen
        name="PlausibleDeniability"
        component={PlausibleDeniability}
        options={navigationStyle({ title: loc.plausibledeniability.title })(theme)}
      />
      <DetailViewStack.Screen
        name="TrackPayment"
        component={TrackPayment}
        options={navigationStyle({
          title: loc.track_payment.title,
          statusBarStyle: 'auto',
        })(theme)}
      />
      <DetailViewStack.Screen
        name="PaymentFound"
        component={PaymentFound}
        options={navigationStyle({
          title: loc.payment_found.title,
          statusBarStyle: 'auto',
        })(theme)}
      />
      <DetailViewStack.Screen
        name="NoPaymentFound"
        component={NoPaymentFound}
        options={navigationStyle({
          title: loc.no_payment_found.title,
          statusBarStyle: 'auto',
        })(theme)}
      />
      <DetailViewStack.Screen
        name="ReceiveDetails"
        component={ReceiveDetails}
        options={navigationStyle({
          title: loc.receive.header,
          closeButtonPosition: CloseButtonPosition.Left,
          statusBarStyle: 'light',
          headerShown: true,
          presentation: 'modal',
        })(theme)}
      />
      <DetailViewStack.Screen
        name="SyncScreen"
        component={SyncScreen}
        options={navigationStyle({
          title: loc.sync.title,
          statusBarStyle: 'auto',
        })(theme)}
      />
    </DetailViewStack.Navigator>
  );
};

export default DetailViewStackScreensStack;

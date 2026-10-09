import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import CheckboxRow from './CheckboxRow';
import InfoBanner from './InfoBanner';
import PassphraseField from './PassphraseField';
import TipCard from './TipCard';
import EyeIcon from './icons/EyeIcon';
import KeyIcon from './icons/KeyIcon';
import WritePaperIcon from './icons/WritePaperIcon';
import { useTheme } from './themes';
import { ClashFont } from '../constants/fonts';
import loc from '../loc';

export type NewPassphraseState = {
  enabled: boolean;
  passphrase: string;
  confirmation: string;
  acknowledged: boolean;
};

export const EMPTY_NEW_PASSPHRASE: NewPassphraseState = { enabled: false, passphrase: '', confirmation: '', acknowledged: false };

const PASSPHRASE_TIPS = [
  { Icon: KeyIcon, bold: loc.passphrase.tip_not_stored_bold, body: loc.passphrase.tip_not_stored_body },
  { Icon: WritePaperIcon, bold: loc.passphrase.tip_exact_bold, body: loc.passphrase.tip_exact_body },
  { Icon: EyeIcon, bold: loc.passphrase.tip_privacy_bold, body: loc.passphrase.tip_privacy_body },
];

// Printable ASCII only: what every hardware wallet can type.
const NON_ASCII = /[^\x20-\x7e]/;

/** The passphrase to apply, or undefined when none was chosen; null while the form is incomplete. */
export const chosenPassphrase = (state: NewPassphraseState): string | undefined | null => {
  if (!state.enabled) return undefined;
  const { passphrase, confirmation, acknowledged } = state;
  const isValid = passphrase.length > 0 && passphrase === passphrase.trim() && confirmation === passphrase && acknowledged;
  return isValid ? passphrase : null;
};

interface NewPassphraseFormProps {
  state: NewPassphraseState;
  onChange: (state: NewPassphraseState) => void;
}

// The opt-in passphrase step of creating a wallet. Typed twice and acknowledged, since a typo
// silently gives a different wallet and nothing can recover a lost one.
const NewPassphraseForm: React.FC<NewPassphraseFormProps> = ({ state, onChange }) => {
  const { colors } = useTheme();
  const { enabled, passphrase, confirmation, acknowledged } = state;
  const update = (patch: Partial<NewPassphraseState>) => onChange({ ...state, ...patch });

  return (
    <View style={styles.container}>
      <CheckboxRow
        label={loc.passphrase.add_toggle}
        checked={enabled}
        onToggle={() => onChange(enabled ? EMPTY_NEW_PASSPHRASE : { ...state, enabled: true })}
        testID="AddPassphrase"
      />
      {enabled && (
        <>
          <Text style={[styles.explanation, { color: colors.textMuted }]}>{loc.passphrase.create_explanation}</Text>
          {PASSPHRASE_TIPS.map(tip => (
            <TipCard key={tip.bold} Icon={tip.Icon} bold={tip.bold} body={tip.body} iconSize={24} />
          ))}
          <PassphraseField value={passphrase} onChangeText={text => update({ passphrase: text })} testID="NewPassphraseInput" />
          <PassphraseField
            label={loc.passphrase.confirm_label}
            value={confirmation}
            onChangeText={text => update({ confirmation: text })}
            testID="NewPassphraseConfirmInput"
          />
          {passphrase !== passphrase.trim() && (
            <Text style={[styles.error, { color: colors.statusError }]}>{loc.passphrase.error_spaces}</Text>
          )}
          {confirmation.length > 0 && confirmation !== passphrase && (
            <Text style={[styles.error, { color: colors.statusError }]}>{loc.passphrase.error_mismatch}</Text>
          )}
          {NON_ASCII.test(passphrase) && <InfoBanner text={loc.passphrase.warning_non_ascii} />}
          <CheckboxRow
            label={loc.passphrase.acknowledge}
            checked={acknowledged}
            onToggle={() => update({ acknowledged: !acknowledged })}
            testID="NewPassphraseAcknowledge"
          />
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { gap: 16 },
  explanation: { fontFamily: ClashFont.regular, fontSize: 15, lineHeight: 22.5 },
  error: { fontFamily: ClashFont.regular, fontSize: 14, lineHeight: 20 },
});

export default NewPassphraseForm;

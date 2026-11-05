import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ClashFont } from '../../constants/fonts';
import { useTheme } from '../themes';

export const formatMessageTime = (unixSeconds: number): string => {
  const d = new Date(unixSeconds * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

interface ChatBubbleProps {
  text: string;
  mine: boolean;
  at: number;
  testID?: string;
}

/** A text message. Mine sit right in the brand colour, theirs left on a neutral surface. */
const ChatBubble: React.FC<ChatBubbleProps> = ({ text, mine, at, testID }) => {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      <View
        testID={testID}
        style={[
          styles.bubble,
          mine ? styles.bubbleMine : styles.bubbleTheirs,
          { backgroundColor: mine ? colors.brandPrimary : colors.fieldBackground },
        ]}
      >
        <Text style={[styles.text, { color: mine ? colors.white : colors.textPrimary }]}>{text}</Text>
        <Text style={[styles.time, { color: mine ? colors.white : colors.textMuted }, mine && styles.timeMine]}>
          {formatMessageTime(at)}
        </Text>
      </View>
    </View>
  );
};

export default React.memo(ChatBubble);

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, gap: 2 },
  bubbleMine: { borderBottomRightRadius: 6 },
  bubbleTheirs: { borderBottomLeftRadius: 6 },
  text: { fontFamily: ClashFont.regular, fontSize: 16, lineHeight: 22 },
  time: { fontFamily: ClashFont.regular, fontSize: 11, alignSelf: 'flex-end' },
  timeMine: { opacity: 0.75 },
});

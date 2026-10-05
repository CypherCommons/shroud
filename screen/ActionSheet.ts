// ActionSheet.ts
import { InteractionManager } from 'react-native';
import presentAlert from '../components/Alert';

import { ActionSheetOptions, CompletionCallback } from './ActionSheet.common';

export default class ActionSheet {
  static showActionSheetWithOptions(options: ActionSheetOptions, completion: CompletionCallback): void {
    InteractionManager.runAfterInteractions(() => {
      const buttons = options.options.map((option, index) => {
        let style: 'default' | 'cancel' | 'destructive' = 'default';
        if (index === options.destructiveButtonIndex) {
          style = 'destructive';
        } else if (index === options.cancelButtonIndex) {
          style = 'cancel';
        }

        return {
          text: option,
          onPress: () => completion(index),
          style,
        };
      });

      presentAlert({
        title: options.title,
        message: options.message ?? '',
        buttons,
        options: { cancelable: options.cancelButtonIndex !== undefined },
      });
    });
  }
}

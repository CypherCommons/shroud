import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { ContactListItem, searchContacts } from '../../class/contacts';
import ContactRow from '../../components/ContactRow';
import ContactsEmptyState from '../../components/ContactsEmptyState';
import SafeArea from '../../components/SafeArea';
import SearchField from '../../components/SearchField';
import { useTheme } from '../../components/themes';
import AddIcon from '../../components/icons/AddIcon';
import HeaderBarButton from '../../components/HeaderBarButton';
import { useContacts } from '../../hooks/context/useContacts';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { hasLiquidGlass } from '../../modules/environment';
import loc from '../../loc';

const ContactList: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useExtendedNavigation();
  const { contactList } = useContacts();
  const [query, setQuery] = useState('');

  const results = useMemo(() => searchContacts(contactList, query), [contactList, query]);

  const openAdd = useCallback(() => navigation.navigate('ContactEdit', { mode: 'add' }), [navigation]);

  const openDetail = useCallback((address: string) => navigation.navigate('ContactDetail', { address }), [navigation]);

  // Prefixed: WalletsList's card variant carries its own `HomeContact-` ids, and Home stays mounted
  // underneath this screen, so a bare `Contact-` id would match two different rows.
  const renderItem = useCallback(
    (p: { item: ContactListItem }) => <ContactRow contact={p.item} onPress={openDetail} testID={`ContactListContact-${p.item.address}`} />,
    [openDetail],
  );

  const HeaderRight = useMemo(
    () => (
      <HeaderBarButton
        accessibilityLabel={loc.contacts.add}
        onPress={openAdd}
        testID="AddContactButton"
        backgroundStyle={[styles.add, { backgroundColor: colors.brandPrimary, borderColor: colors.background }]}
      >
        {/* On glass the "+" sits on the bar's capsule rather than a purple square, so it takes the brand color. */}
        <AddIcon size={24} color={hasLiquidGlass ? colors.brandPrimary : colors.white} />
      </HeaderBarButton>
    ),
    [openAdd, colors.brandPrimary, colors.white, colors.background],
  );

  useLayoutEffect(() => {
    navigation.setOptions({ headerRight: contactList.length > 0 ? () => HeaderRight : undefined });
  }, [navigation, HeaderRight, contactList.length]);

  if (contactList.length === 0) {
    return (
      <SafeArea style={styles.root}>
        <View style={styles.emptyState}>
          <ContactsEmptyState onAdd={openAdd} bordered={false} />
        </View>
      </SafeArea>
    );
  }

  return (
    <SafeArea style={styles.root}>
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder={loc.contacts.search_placeholder}
        style={styles.searchField}
        testID="ContactSearchInput"
      />
      <FlatList
        data={results}
        keyExtractor={item => item.address}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        renderItem={renderItem}
      />
    </SafeArea>
  );
};

export default ContactList;

const styles = StyleSheet.create({
  root: { flex: 1 },
  // This screen *is* the empty state, so it centres the card itself rather than asking the shared
  // component to nudge itself up out of a list footer's position.
  emptyState: { flex: 1, justifyContent: 'center', paddingBottom: 96 },
  searchField: { marginHorizontal: 24, marginTop: 16 },
  add: { borderRadius: 8, borderWidth: 1.63 },
  // Rows are bare here, so the 16pt rhythm is the list's to set.
  listContent: { gap: 16, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 24 },
});

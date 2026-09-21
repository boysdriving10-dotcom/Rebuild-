import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { Stepper } from '@/components/ui/Stepper';
import { BottomTabInset, Colors, FontSize, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useGames } from '@/context/GamesContext';
import { formatResolvedAddress, reverseGeocode } from '@/data/reverseGeocode';
import {
  ADDRESS_UNAVAILABLE,
  FINDING_ADDRESS,
} from '@/hooks/useCourtAddresses';
import type { Court } from '@/types';

const DATE_OPTIONS = ['Today', 'Tomorrow', 'This Weekend'] as const;
const TIME_OPTIONS = ['4:00 PM', '5:00 PM', '6:00 PM', '7:00 PM', '8:00 PM', '9:00 PM'] as const;

function paramString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0]?.trim() ?? '';
  return value?.trim() ?? '';
}

export default function CreateGameScreen() {
  const params = useLocalSearchParams<{
    courtId?: string;
    courtName?: string;
    latitude?: string;
    longitude?: string;
    address?: string;
  }>();
  const { user } = useAuth();
  const { createGame } = useGames();

  /** Real court from Map → Start Game (OSM id + coords + address from Overpass tags / reverse geocode). */
  const selectedCourtFromParams: Court | null = useMemo(() => {
    const courtId = paramString(params.courtId);
    const courtName = paramString(params.courtName);
    if (!courtId || !courtName) return null;
    const lat = Number(paramString(params.latitude));
    const lng = Number(paramString(params.longitude));
    const address = paramString(params.address);
    return {
      id: courtId,
      name: courtName,
      latitude: Number.isFinite(lat) ? lat : 0,
      longitude: Number.isFinite(lng) ? lng : 0,
      address: address || ADDRESS_UNAVAILABLE,
      activeGameIds: [],
    };
  }, [params.courtId, params.courtName, params.latitude, params.longitude, params.address]);

  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);

  // Finish reverse-geocode on Create if Map handed off before Nominatim returned.
  useEffect(() => {
    if (!selectedCourtFromParams) {
      setResolvedAddress(null);
      return;
    }
    const current = selectedCourtFromParams.address;
    if (current !== ADDRESS_UNAVAILABLE && current !== FINDING_ADDRESS) {
      setResolvedAddress(null);
      return;
    }

    let cancelled = false;
    setResolvedAddress(FINDING_ADDRESS);

    (async () => {
      const result = await reverseGeocode(
        selectedCourtFromParams.latitude,
        selectedCourtFromParams.longitude
      );
      if (cancelled) return;
      setResolvedAddress(formatResolvedAddress(result) ?? ADDRESS_UNAVAILABLE);
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedCourtFromParams]);

  const selectedCourt: Court | null = useMemo(() => {
    if (!selectedCourtFromParams) return null;
    if (resolvedAddress) {
      return { ...selectedCourtFromParams, address: resolvedAddress };
    }
    return selectedCourtFromParams;
  }, [selectedCourtFromParams, resolvedAddress]);

  const [date, setDate] = useState<(typeof DATE_OPTIONS)[number]>('Today');
  const [time, setTime] = useState<(typeof TIME_OPTIONS)[number]>('6:00 PM');
  const [maxPlayers, setMaxPlayers] = useState(10);

  const onCreate = () => {
    if (!user) {
      Alert.alert('Not logged in', 'Log in to create a game.');
      return;
    }
    if (!selectedCourt) {
      Alert.alert('Pick a court', 'Open the Map tab and choose a court first.');
      return;
    }

    const result = createGame(
      {
        courtId: selectedCourt.id,
        courtName: selectedCourt.name,
        courtLatitude: selectedCourt.latitude,
        courtLongitude: selectedCourt.longitude,
        courtAddress: selectedCourt.address,
        date,
        time,
        maxPlayers,
        isPublic: true,
      },
      { id: user.id, username: user.username }
    );

    if (!result.ok) {
      Alert.alert('Couldn’t create game', result.error);
      return;
    }

    Alert.alert(
      'Game Created',
      `${selectedCourt.name}\n${date} · ${time}\n${maxPlayers} max`,
      [
        {
          text: 'Nice',
          onPress: () => router.replace('/(tabs)'),
        },
      ]
    );
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text style={styles.title}>Create Game</Text>
            <Text style={styles.subtitle}>Set it up in seconds.</Text>
          </View>

          <Field label="Court">
            {selectedCourt ? (
              <View style={[styles.option, styles.optionSelected]}>
                <Text style={[styles.optionText, styles.optionTextSelected]}>
                  {selectedCourt.name}
                </Text>
                <Text style={styles.optionMeta} numberOfLines={2}>
                  {selectedCourt.address}
                </Text>
              </View>
            ) : (
              <View style={styles.pickCourt}>
                <Text style={styles.pickCourtText}>
                  Pick a basketball court on the Map, then tap Start Game.
                </Text>
                <Button title="Open Map" variant="secondary" onPress={() => router.push('/(tabs)/map')} />
              </View>
            )}
          </Field>

          <Field label="Date">
            <View style={styles.chipRow}>
              {DATE_OPTIONS.map((option) => {
                const selected = option === date;
                return (
                  <Pressable
                    key={option}
                    onPress={() => setDate(option)}
                    style={[styles.chip, selected && styles.chipSelected]}>
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {option}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Field>

          <Field label="Time">
            <View style={styles.chipRow}>
              {TIME_OPTIONS.map((option) => {
                const selected = option === time;
                return (
                  <Pressable
                    key={option}
                    onPress={() => setTime(option)}
                    style={[styles.chip, selected && styles.chipSelected]}>
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {option}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Field>

          <Field label="Max Players">
            <Stepper value={maxPlayers} min={2} max={20} onChange={setMaxPlayers} />
          </Field>

          <Button
            title="Create Game"
            onPress={onCreate}
            disabled={!selectedCourt}
            style={styles.submit}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    gap: Spacing['2xl'],
    paddingBottom: BottomTabInset + Spacing.xl,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
  },
  header: {
    gap: Spacing.xs,
  },
  title: {
    color: Colors.text,
    fontSize: FontSize['2xl'],
    fontWeight: '800',
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
  },
  field: {
    gap: Spacing.md,
  },
  fieldLabel: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  optionList: {
    gap: Spacing.sm,
  },
  option: {
    backgroundColor: Colors.surfaceElevated,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: 4,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  optionSelected: {
    backgroundColor: Colors.accentSoft,
    borderColor: Colors.accent,
  },
  optionText: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  optionTextSelected: {
    color: Colors.text,
  },
  optionMeta: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    lineHeight: 18,
  },
  pickCourt: {
    backgroundColor: Colors.surfaceElevated,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  pickCourtText: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
    lineHeight: 22,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  chip: {
    backgroundColor: Colors.surfaceElevated,
    borderColor: Colors.border,
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  chipSelected: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  chipText: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  chipTextSelected: {
    color: Colors.white,
  },
  submit: {
    marginTop: Spacing.sm,
  },
});

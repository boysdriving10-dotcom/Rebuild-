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
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Stepper } from '@/components/ui/Stepper';
import { BottomTabInset, Colors, FontSize, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useGames } from '@/context/GamesContext';
import { MOCK_COURTS } from '@/data/mock';
import type { Court } from '@/types';

const DATE_OPTIONS = ['Today', 'Tomorrow', 'This Weekend'] as const;
const TIME_OPTIONS = ['4:00 PM', '5:00 PM', '6:00 PM', '7:00 PM', '8:00 PM', '9:00 PM'] as const;

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

  const paramCourt: Court | null = useMemo(() => {
    if (!params.courtId || !params.courtName) return null;
    const lat = Number(params.latitude);
    const lng = Number(params.longitude);
    return {
      id: params.courtId,
      name: params.courtName,
      latitude: Number.isFinite(lat) ? lat : 0,
      longitude: Number.isFinite(lng) ? lng : 0,
      address: params.address || 'Address unavailable',
      activeGameIds: [],
    };
  }, [params.courtId, params.courtName, params.latitude, params.longitude, params.address]);

  const courtOptions = useMemo(() => {
    if (!paramCourt) return MOCK_COURTS;
    if (MOCK_COURTS.some((c) => c.id === paramCourt.id)) return MOCK_COURTS;
    return [paramCourt, ...MOCK_COURTS];
  }, [paramCourt]);

  const [courtId, setCourtId] = useState(paramCourt?.id ?? MOCK_COURTS[0]?.id ?? '');
  const [date, setDate] = useState<(typeof DATE_OPTIONS)[number]>('Today');
  const [time, setTime] = useState<(typeof TIME_OPTIONS)[number]>('6:00 PM');
  const [maxPlayers, setMaxPlayers] = useState(10);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');

  useEffect(() => {
    if (paramCourt) setCourtId(paramCourt.id);
  }, [paramCourt]);

  const selectedCourt = useMemo(
    () => courtOptions.find((c) => c.id === courtId),
    [courtId, courtOptions]
  );

  const onCreate = () => {
    if (!user) {
      Alert.alert('Not logged in', 'Log in to create a game.');
      return;
    }
    if (!selectedCourt) {
      Alert.alert('Pick a court', 'Choose a court for your game.');
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
        isPublic: visibility === 'public',
      },
      { id: user.id, username: user.username }
    );

    if (!result.ok) {
      Alert.alert('Couldn’t create game', result.error);
      return;
    }

    Alert.alert(
      'Game Created',
      `${selectedCourt.name}\n${date} · ${time}\n${maxPlayers} max · ${
        visibility === 'public' ? 'Public' : 'Private'
      }`,
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
            <View style={styles.optionList}>
              {courtOptions.map((court) => {
                const selected = court.id === courtId;
                return (
                  <Pressable
                    key={court.id}
                    onPress={() => setCourtId(court.id)}
                    style={[styles.option, selected && styles.optionSelected]}>
                    <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                      {court.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
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

          <Field label="Visibility">
            <SegmentedControl
              value={visibility}
              onChange={setVisibility}
              options={[
                { label: 'Public', value: 'public' },
                { label: 'Private', value: 'private' },
              ]}
            />
          </Field>

          <Button title="Create Game" onPress={onCreate} style={styles.submit} />
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

import { Link, router } from 'expo-router';
import { useState } from 'react';
import {
  Image,
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
import { TextField } from '@/components/ui/TextField';
import { Colors, FontSize, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';

const logo = require('../../../assets/images/ballout-logo.png');

export default function CreateAccountScreen() {
  const { createAccount } = useAuth();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | undefined>();

  const clearError = () => setError(undefined);

  const onSubmit = () => {
    const result = createAccount({ username, email, password, confirmPassword });
    if (!result.ok) {
      setError(result.error);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <Image
              source={logo}
              style={styles.logo}
              accessibilityLabel="BallOut"
              resizeMode="contain"
            />
            <Text style={styles.title}>Create Account</Text>
            <Text style={styles.subtitle}>Join BallOut and start balling out.</Text>
          </View>

          <View style={styles.form}>
            <TextField
              label="Username"
              autoCapitalize="none"
              autoComplete="username"
              placeholder="hooper22"
              value={username}
              onChangeText={(text) => {
                setUsername(text);
                clearError();
              }}
            />
            <TextField
              label="Email"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="you@email.com"
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                clearError();
              }}
            />
            <TextField
              label="Password"
              autoCapitalize="none"
              autoComplete="new-password"
              placeholder="At least 6 characters"
              secureTextEntry
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                clearError();
              }}
            />
            <TextField
              label="Confirm Password"
              autoCapitalize="none"
              autoComplete="new-password"
              placeholder="Repeat password"
              secureTextEntry
              value={confirmPassword}
              onChangeText={(text) => {
                setConfirmPassword(text);
                clearError();
              }}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button title="Create Account" onPress={onSubmit} />
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account?</Text>
            <Link href="/(auth)/login" asChild>
              <Pressable onPress={() => router.back()}>
                <Text style={styles.footerLink}>Log In</Text>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing['2xl'],
    paddingVertical: Spacing['4xl'],
    gap: Spacing['2xl'],
  },
  hero: {
    gap: Spacing.sm,
  },
  logo: {
    borderRadius: Radius.md,
    height: 56,
    marginBottom: Spacing.xs,
    width: 56,
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
  form: {
    gap: Spacing.lg,
  },
  error: {
    color: Colors.danger,
    fontSize: FontSize.sm,
    fontWeight: '600',
    textAlign: 'center',
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.sm,
    justifyContent: 'center',
  },
  footerText: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
  },
  footerLink: {
    color: Colors.accent,
    fontSize: FontSize.sm,
    fontWeight: '700',
  },
});

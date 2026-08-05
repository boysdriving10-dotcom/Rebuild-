import { Link } from 'expo-router';
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

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();

  const onSubmit = () => {
    const result = login(email, password);
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
            <Text style={styles.tagline}>Find pickup games near you.</Text>
          </View>

          <View style={styles.form}>
            <TextField
              label="Email"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="you@email.com"
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                setError(undefined);
              }}
            />
            <TextField
              label="Password"
              autoCapitalize="none"
              autoComplete="password"
              placeholder="••••••••"
              secureTextEntry
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                setError(undefined);
              }}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button title="Log In" onPress={onSubmit} />
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Don&apos;t have an account?</Text>
            <Link href="/(auth)/create-account" asChild>
              <Pressable>
                <Text style={styles.footerLink}>Create Account</Text>
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
    gap: Spacing['3xl'],
  },
  hero: {
    alignItems: 'center',
    gap: Spacing.md,
  },
  logo: {
    borderRadius: Radius.lg,
    height: 88,
    width: 88,
  },
  tagline: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
    fontWeight: '500',
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

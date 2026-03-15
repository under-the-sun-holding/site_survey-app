import React from 'react';
import { Redirect } from 'expo-router';
import HomeScreen from '../src/screens/HomeScreen';
import { useAuth } from '../src/context/AuthContext';

export default function IndexRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return null;
  }

  if (!user) {
    return <Redirect href="/login" />;
  }

  return <HomeScreen />;
}

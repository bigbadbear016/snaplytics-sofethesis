// src/components/FullscreenBars.js
// Kiosk is full screen: hide the status bar and Android's navigation bar.
// Android lets users swipe from the edge to reveal them briefly; they auto-hide again.
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationBar } from 'expo-navigation-bar';

export default function FullscreenBars() {
  return (
    <>
      <StatusBar hidden />
      <NavigationBar hidden />
    </>
  );
}

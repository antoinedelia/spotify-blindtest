import React, { createContext, useState, useMemo } from 'react';

// This is the initial state, read from the .env file just once as a default.
const initialSettings = {
    questionsPerQuiz: Number(import.meta.env.VITE_QUESTIONS_PER_QUIZ) || 10,
    numAnswerOptions: Number(import.meta.env.VITE_NUM_ANSWER_OPTIONS) || 4,
    minSongsToPlay: Number(import.meta.env.VITE_MIN_SONGS_TO_PLAY) || 10,
    pointsBase: Number(import.meta.env.VITE_POINTS_BASE) || 50,
    pointsPerSecond: Number(import.meta.env.VITE_POINTS_PER_SECOND) || 7,
    timeBonusPoints: Number(import.meta.env.VITE_TIME_BONUS_POINTS) || 50,
    timeBonusThreshold: Number(import.meta.env.VITE_TIME_BONUS_THRESHOLD) || 13,
    // You can keep the combo tiers simple here or parse them if you want them editable too.
    // For simplicity in the modal, we'll keep them as they are for now.
    comboTiers: [
        { threshold: 6, multiplier: 2.0 },
        { threshold: 4, multiplier: 1.5 },
        { threshold: 2, multiplier: 1.2 },
    ]
};

// Create the context
export const SettingsContext = createContext();

// Create the provider component
export const SettingsProvider = ({ children }) => {
    const [settings, setSettings] = useState(initialSettings);

    const updateSettings = (newSettings) => {
        setSettings(prevSettings => ({ ...prevSettings, ...newSettings }));
    };

    // Use useMemo to prevent unnecessary re-renders of consuming components
    const value = useMemo(() => ({ settings, updateSettings }), [settings]);

    return (
        <SettingsContext.Provider value={value}>
            {children}
        </SettingsContext.Provider>
    );
};
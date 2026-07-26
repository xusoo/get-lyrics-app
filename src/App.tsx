import { LoginScreen } from './components/LoginScreen';
import { MainView } from './components/MainView';
import { SetupScreen } from './components/SetupScreen';
import { useSpotifyAuth } from './hooks/useSpotifyAuth';

function App() {
  const {
    token,
    user,
    login,
    logout,
    error,
    isConfigured,
    saveSpotifySetup,
    clearSpotifySetup,
    getSetupDraft,
  } = useSpotifyAuth();

  if (!token) {
    if (!isConfigured) {
      const draft = getSetupDraft();
      return (
        <SetupScreen
          initialClientId={draft.clientId}
          initialRedirectUri={draft.redirectUri}
          onSave={saveSpotifySetup}
          error={error}
        />
      );
    }
    return <LoginScreen onLogin={login} error={error} />;
  }

  return (
    <MainView
      token={token}
      user={user}
      onLogout={logout}
      onForgetSpotifySetup={clearSpotifySetup}
      onSaveSpotifySetup={saveSpotifySetup}
    />
  );
}

export default App;

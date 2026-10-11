
import { GoogleLogin } from '@react-oauth/google';

export default function Login({ onLogin }) {
  const handleSuccess = async (response) => {
    try {
      const result = await fetch('/auth/google', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          credential: response.credential,
        }),
      });

      if (!result.ok) {
        throw new Error('Google authentication failed');
      }

      const session = await result.json();
      onLogin(session);
    } catch (error) {
      console.error('Login error:', error);
      alert('Unable to authenticate your Google account.');
    }
  };

  return (
    <main className="login-container">
      <h1>Autoclicker Dashboard</h1>
      <p>Sign in with your Google account to continue.</p>

      <GoogleLogin
        onSuccess={handleSuccess}
        onError={() => console.error('Google Sign-In failed')}
      />
    </main>
  );
}

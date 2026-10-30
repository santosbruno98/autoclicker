import { GoogleLogin } from '@react-oauth/google';
import { authAPI } from '../services/http';

export default function Login({ onLogin }) {
  const handleSuccess = async (response) => {
    try {
      if (!response.credential) {
        throw new Error('Google did not return an identity credential');
      }

      const { data: session } = await authAPI.post('/auth/google', {
        credential: response.credential,
      });

      if (session?.authenticated !== true) {
        throw new Error('Google authentication failed');
      }

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
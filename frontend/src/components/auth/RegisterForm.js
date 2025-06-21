import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Box, TextField, Button, Typography, Paper, Container, Link as MuiLink } from '@mui/material';

export default function RegisterForm() {
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    displayName: '',
    password: '',
    confirmPassword: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (formData.password !== formData.confirmPassword) {
      return setError('Passwords do not match');
    }
    
    setLoading(true);
    
    const { success, error: registerError } = await register(
      formData.username,
      formData.password,
      formData.email,
      formData.displayName
    );
    
    setLoading(false);
    
    if (success) {
      navigate('/');
    } else {
      setError(registerError || 'Failed to create account');
    }
  };

  return (
    <Container component="main" maxWidth="xs">
      <Paper elevation={3} sx={{ mt: 4, p: 4, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Typography component="h1" variant="h5">
          Create an account
        </Typography>
        
        {error && (
          <Typography color="error" sx={{ mt: 2, textAlign: 'center' }}>
            {error}
          </Typography>
        )}
        
        <Box component="form" onSubmit={handleSubmit} sx={{ mt: 1, width: '100%' }}>
          <TextField
            margin="normal"
            required
            fullWidth
            id="username"
            label="Username"
            name="username"
            autoComplete="username"
            autoFocus
            value={formData.username}
            onChange={handleChange}
          />
          <TextField
            margin="normal"
            fullWidth
            id="email"
            label="Email Address"
            name="email"
            autoComplete="email"
            type="email"
            value={formData.email}
            onChange={handleChange}
          />
          <TextField
            margin="normal"
            fullWidth
            id="displayName"
            label="Display Name"
            name="displayName"
            autoComplete="name"
            value={formData.displayName}
            onChange={handleChange}
          />
          <TextField
            margin="normal"
            required
            fullWidth
            name="password"
            label="Password"
            type="password"
            id="password"
            autoComplete="new-password"
            value={formData.password}
            onChange={handleChange}
          />
          <TextField
            margin="normal"
            required
            fullWidth
            name="confirmPassword"
            label="Confirm Password"
            type="password"
            id="confirmPassword"
            value={formData.confirmPassword}
            onChange={handleChange}
          />
          <Button
            type="submit"
            fullWidth
            variant="contained"
            disabled={loading}
            sx={{ mt: 3, mb: 2 }}
          >
            {loading ? 'Creating Account...' : 'Sign Up'}
          </Button>
          <Box sx={{ textAlign: 'center' }}>
            <MuiLink component={Link} to="/login" variant="body2">
              Already have an account? Sign in
            </MuiLink>
          </Box>
        </Box>
      </Paper>
    </Container>
  );
}

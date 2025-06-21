import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { createMarket } from '../../utils/api';
import { 
  Box, Typography, Paper, TextField, Button, MenuItem, 
  Snackbar, Alert, CircularProgress 
} from '@mui/material';

const outcomeTypes = [
  { value: 'continuous', label: 'Continuous (range)' },
  { value: 'binary', label: 'Binary (yes/no)' },
  { value: 'categorical', label: 'Categorical (list)' },
];

function CreateMarketForm({ onMarketCreated }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [outcomeType, setOutcomeType] = useState('continuous');
  const [outcomeMin, setOutcomeMin] = useState('');
  const [outcomeMax, setOutcomeMax] = useState('');
  const [outcomeCategories, setOutcomeCategories] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login', { state: { from: '/create-market' } });
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (!isAuthenticated) {
      setError('Please log in to create a market');
      return;
    }

    try {
      setLoading(true);
      const payload = {
        title,
        description,
        outcome_type: outcomeType,
        outcome_min: null,
        outcome_max: null,
        outcome_categories: outcomeType === 'categorical' ? 
          outcomeCategories.split(',').map(c => c.trim()).filter(Boolean) : null,
      };
      
      const newMarket = await createMarket(payload);
      
      // Reset form
      setTitle('');
      setDescription('');
      setOutcomeType('continuous');
      setOutcomeMin('');
      setOutcomeMax('');
      setOutcomeCategories('');
      
      setSnackbar({ 
        open: true, 
        message: 'Market created successfully!', 
        severity: 'success' 
      });
      
      if (onMarketCreated) onMarketCreated(newMarket);
      
    } catch (err) {
      const errorMsg = err.response?.data?.detail || 'Failed to create market';
      setError(errorMsg);
      setSnackbar({ 
        open: true, 
        message: errorMsg, 
        severity: 'error' 
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCloseSnackbar = () => {
    setSnackbar(prev => ({ ...prev, open: false }));
  };

  return (
    <>
      <Box sx={{ my: 4 }}>
        <Typography variant="h4" gutterBottom>
          Create New Market
        </Typography>
        <Paper sx={{ p: 3 }} elevation={3}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          
          <Box component="form" onSubmit={handleSubmit}>
            <TextField 
              label="Title" 
              value={title} 
              onChange={e => setTitle(e.target.value)} 
              fullWidth 
              margin="normal" 
              required 
            />
            
            <TextField 
              label="Description" 
              value={description} 
              onChange={e => setDescription(e.target.value)} 
              fullWidth 
              margin="normal" 
              multiline 
              rows={3} 
            />
            
            <TextField 
              select 
              label="Outcome Type" 
              value={outcomeType} 
              onChange={e => setOutcomeType(e.target.value)} 
              fullWidth 
              margin="normal" 
              required
            >
              {outcomeTypes.map(opt => (
                <MenuItem key={opt.value} value={opt.value}>
                  {opt.label}
                </MenuItem>
              ))}
            </TextField>
            

            
            {outcomeType === 'categorical' && (
              <TextField 
                label="Categories (comma-separated)" 
                value={outcomeCategories} 
                onChange={e => setOutcomeCategories(e.target.value)} 
                fullWidth 
                margin="normal" 
                helperText="e.g., Option 1, Option 2, Option 3" 
                required 
              />
            )}
            
            <Button 
              type="submit" 
              variant="contained" 
              disabled={loading} 
              sx={{ mt: 2 }}
            >
              {loading ? <CircularProgress size={24} /> : 'Create Market'}
            </Button>
          </Box>
        </Paper>
      </Box>
      
      <Snackbar 
        open={snackbar.open} 
        autoHideDuration={6000} 
        onClose={handleCloseSnackbar} 
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
}

export default CreateMarketForm;

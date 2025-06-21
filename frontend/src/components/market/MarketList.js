import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, Paper, List, ListItem, ListItemText, Divider, CircularProgress, Button } from '@mui/material';
import { getMarkets } from '../../utils/api';

function MarketList() {
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const loadMarkets = async () => {
      try {
        setLoading(true);
        const data = await getMarkets();
        setMarkets(data);
        setError('');
      } catch (err) {
        setError('Failed to load markets');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    
    loadMarkets();
  }, []);

  if (loading) return <CircularProgress />;
  if (error) return <Typography color="error">{error}</Typography>;

  return (
    <Box sx={{ my: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" gutterBottom>
          Markets
        </Typography>
        <Button variant="contained" color="primary" onClick={() => navigate('/create-market')}>
          Create Market
        </Button>
      </Box>
      <Paper>
        <List>
          {markets.length === 0 ? (
            <ListItem><ListItemText primary="No markets available. Create one to get started!" /></ListItem>
          ) : (
            markets.map((market) => (
              <React.Fragment key={market.id}>
                <ListItem button onClick={() => navigate(`/markets/${market.id}`)}>
                  <ListItemText
                    primary={market.title}
                    secondary={market.description || `Type: ${market.outcome_type}`}
                  />
                </ListItem>
                <Divider />
              </React.Fragment>
            ))
          )}
        </List>
      </Paper>
    </Box>
  );
}

export default MarketList;

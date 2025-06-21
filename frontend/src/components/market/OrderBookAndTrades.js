import React from 'react';
import { 
  Box, 
  Typography, 
  Paper, 
  Table, 
  TableBody, 
  TableCell, 
  TableContainer, 
  TableHead, 
  TableRow, 
  Divider,
  Chip
} from '@mui/material';
import { formatCurrency } from '../../utils/lmsr';

/**
 * OrderBookAndTrades component
 * @param {Object[]} orderBook - Array of { price, size, side, description }
 * @param {Object[]} trades - Array of { price, size, side, description, user, time }
 * @param {Function} getBucketDescription - Function to get bucket description
 */
export default function OrderBookAndTrades({ 
  orderBook = [], 
  trades = [], 
  getBucketDescription 
}) {
  return (
    <Box sx={{ mt: 4 }}>
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6" gutterBottom>Order Book (AMM Bid/Ask)</Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Contract</TableCell>
                <TableCell align="right">Price</TableCell>
                <TableCell align="right">Size</TableCell>
                <TableCell>Side</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {orderBook.length === 0 ? (
                <TableRow><TableCell colSpan={4} align="center">No open orders</TableCell></TableRow>
              ) : orderBook.slice(0, 20).map((order, i) => (
                <TableRow key={i} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ maxWidth: 300 }} noWrap>
                      {order.description || 'Unknown contract'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    {order.price != null ? `$${order.price.toFixed(6)}` : '-'}
                  </TableCell>
                  <TableCell align="right">{order.size}</TableCell>
                  <TableCell>
                    <Chip 
                      label={order.side} 
                      size="small" 
                      color={order.side === 'buy' ? 'primary' : 'secondary'}
                      variant="outlined"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>Trade History</Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
          <TableRow>
            <TableCell>Time</TableCell>
            <TableCell>Contract</TableCell>
            <TableCell align="right">Price</TableCell>
            <TableCell align="right">Size</TableCell>
            <TableCell>Side</TableCell>
          </TableRow>
        </TableHead>
            <TableBody>
              {trades.length === 0 ? (
                <TableRow><TableCell colSpan={5} align="center">No trades yet</TableCell></TableRow>
              ) : [...trades].reverse().slice(0, 10).map((trade, i) => (
                <TableRow key={i} hover>
                  <TableCell>{trade.time}</TableCell>
                  <TableCell sx={{ maxWidth: 300 }}>
                    <Typography variant="body2" noWrap>
                      {trade.description || 'Unknown contract'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    {trade.price != null ? `$${trade.price.toFixed(6)}` : '-'}
                  </TableCell>
                  <TableCell align="right">{trade.size}</TableCell>
                  <TableCell>
                    <Chip 
                      label={trade.side} 
                      size="small" 
                      color={trade.side === 'buy' ? 'primary' : 'secondary'}
                      variant="outlined"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
}

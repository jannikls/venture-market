import React from 'react';
import { Box, Typography, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Divider } from '@mui/material';

/**
 * OrderBookAndTrades component
 * @param {Object[]} orderBook - Array of { price, bucket, size, side }
 * @param {Object[]} trades - Array of { price, bucket, size, side, user, time }
 * @param {Array} buckets - Buckets info
 */
export default function OrderBookAndTrades({ orderBook, trades, buckets }) {
  return (
    <Box sx={{ mt: 4 }}>
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="h6" gutterBottom>Order Book (Synthetic, AMM-backed)</Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Bucket</TableCell>
                <TableCell>Price</TableCell>
                <TableCell>Size</TableCell>
                <TableCell>Side</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {orderBook.length === 0 ? (
                <TableRow><TableCell colSpan={4}>No orders</TableCell></TableRow>
              ) : orderBook.map((order, i) => (
                <TableRow key={i}>
                  <TableCell>{order.bucket != null && buckets[order.bucket] ? `${buckets[order.bucket].low.toLocaleString()} - ${buckets[order.bucket].high.toLocaleString()}` : '-'}</TableCell>
                  <TableCell>{order.price != null ? `$${order.price.toFixed(4)}` : '-'}</TableCell>
                  <TableCell>{order.size}</TableCell>
                  <TableCell>{order.side}</TableCell>
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
                <TableCell>User</TableCell>
                <TableCell>Bucket</TableCell>
                <TableCell>Price</TableCell>
                <TableCell>Size</TableCell>
                <TableCell>Side</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {trades.length === 0 ? (
                <TableRow><TableCell colSpan={6}>No trades</TableCell></TableRow>
              ) : trades.map((trade, i) => (
                <TableRow key={i}>
                  <TableCell>{trade.time}</TableCell>
                  <TableCell>{trade.user}</TableCell>
                  <TableCell>{trade.bucket != null && buckets[trade.bucket] ? `${buckets[trade.bucket].low.toLocaleString()} - ${buckets[trade.bucket].high.toLocaleString()}` : '-'}</TableCell>
                  <TableCell>{trade.price != null ? `$${trade.price.toFixed(4)}` : '-'}</TableCell>
                  <TableCell>{trade.size}</TableCell>
                  <TableCell>{trade.side}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
}

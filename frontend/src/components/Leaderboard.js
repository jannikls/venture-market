import React, { useEffect, useState } from 'react';
import { Box, Typography, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';

const API_BASE_URL = 'http://127.0.0.1:8000';

export default function Leaderboard() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    fetch(`${API_BASE_URL}/leaderboard`)
      .then(res => res.json())
      .then(setRows);
  }, []);
  return (
    <Paper sx={{ p: 2, mt: 3 }}>
      <Typography variant="h6" gutterBottom>Leaderboard (P&L)</Typography>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>User</TableCell>
              <TableCell>Display Name</TableCell>
              <TableCell align="right">Balance</TableCell>
              <TableCell align="right">P&L</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow key={row.username} selected={i === 0}>
                <TableCell>{row.username}</TableCell>
                <TableCell>{row.display_name}</TableCell>
                <TableCell align="right">${row.balance.toFixed(2)}</TableCell>
                <TableCell align="right">${row.pnl.toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}

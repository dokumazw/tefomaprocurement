import http from './http';

export const authAPI: any = {
  login: (credentials: any) => http.post('/auth/login', credentials),
  verifyOtp: (data: any) => http.post('/auth/verify-otp', data),
  register: (data: any) => http.post('/auth/register', data),
  getMe: () => http.get('/auth/me'),
  // An empty object, not null: with the JSON content type axios sends null as
  // the text "null", which the API's JSON reader refuses with a 400, so the
  // session was never ended on the server.
  logout: (token: string) => http.post('/auth/logout', {}, { headers: { Authorization: `Bearer ${token}` } }),
  updateProfile: (data: any) => http.put('/auth/profile', data),
  changePassword: (data: any) => http.put('/auth/change-password', data),
  forgotPassword: (data: any) => http.post('/auth/forgot-password', data),
  resetPassword: (data: any) => http.post('/auth/reset-password', data)
};

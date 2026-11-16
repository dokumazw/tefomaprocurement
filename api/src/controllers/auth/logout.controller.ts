import type { Request, Response } from 'express';
import { User } from '../../models/index.js';
import { createAuditLog } from '../../middleware/index.js';
import { bearerToken, sessionTokenExpiry, sessionTokenHash } from '../../lib/sessionToken.js';

/**
 * End the session this request was made with.
 *
 * A signed token is valid until it expires, so clearing it from the browser
 * alone left any copy of it working for days. This records it as ended;
 * `protect` then refuses it. Other sessions of the same user (another
 * device) carry on.
 */
const logout = async (req: Request, res: Response): Promise<any> => {
  try {
    const token = bearerToken(req.headers.authorization);
    if (!token) {
      return res.status(400).json({ success: false, message: 'No session to end' });
    }

    const userId = req.user!._id;
    // Entries whose token has expired anyway are dropped first, so the list
    // only ever holds sessions that would otherwise still work.
    await User.updateOne({ _id: userId }, { $pull: { revokedSessions: { expiresAt: { $lte: new Date() } } } });
    await User.updateOne(
      { _id: userId },
      { $push: { revokedSessions: { tokenHash: sessionTokenHash(token), expiresAt: sessionTokenExpiry(token) } } }
    );

    await createAuditLog({
      action: 'logout',
      entity: 'User',
      entityId: userId,
      user: req.user,
      entityLabel: req.user!.email,
      description: `${req.user!.role} signed out`,
      req
    });

    res.status(200).json({ success: true, message: 'Signed out' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export default logout;

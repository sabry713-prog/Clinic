/**
 * Express Request augmentation — adds authenticated user properties
 * set by RBAC guard and auth controller.
 */
declare namespace Express {
  interface Request {
    authenticatedUserId?: string;
    authenticatedUserRole?: string;
  }
}

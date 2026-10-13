'use strict';

// 简易内存限速器：单实例部署（活动规模 ≤100 人）足够，不引入外部依赖。
// 用于登录/注册等敏感端点，防脚本爆破；正常用户使用完全无感。
function rateLimit({ windowMs = 60000, max = 30, message = '操作过于频繁，请稍后再试' } = {}) {
  const hits = new Map(); // key -> { count, resetAt }

  return function limiter(req, res, next) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${ip}|${req.method}|${req.baseUrl}${req.path}`;
    const now = Date.now();
    let rec = hits.get(key);
    if (!rec || rec.resetAt <= now) {
      rec = { count: 0, resetAt: now + windowMs };
      hits.set(key, rec);
    }
    rec.count += 1;

    // 防内存无限增长：超阈值时清理过期记录
    if (hits.size > 5000) {
      for (const [k, v] of hits) {
        if (v.resetAt <= now) hits.delete(k);
      }
    }

    if (rec.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((rec.resetAt - now) / 1000)));
      return res.status(429).json({
        error: { code: 'RATE_LIMITED', message },
      });
    }
    next();
  };
}

module.exports = { rateLimit };

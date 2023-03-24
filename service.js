const express = require("express");
const request = require("request");
const swaggerUi = require("swagger-ui-express");
const swaggerJsDoc = require("swagger-jsdoc");
const jwt = require("jsonwebtoken");
const MySqlManager = require("./dataManager");
const bunyan = require("bunyan");

const INITAL_TOTAL_COUNT = 20000;
const AWARD_COUNT = 10000;
const INITAL_STATUS = 0;
const SK_OPENAI_API_KEY ="";
const WX_APP_ID = "";
const WX_APP_SECRET = "";
const secret = "";

const ERROR_CODE_USER_NOT_EXIST = 201
const ERROR_CODE_USER_COUNT_EMPTY = 202

const app = express();

// 创建一个日志记录器
const logger = bunyan.createLogger({
  name: "myapp",
  level: "error",
  streams: [{ path: "./myapp.log" }, { stream: process.stdout }],
});

// Swagger文档配置
const swaggerOptions = {
  swaggerDefinition: {
    info: {
      title: "My API",
      description: "My API Description",
      version: "1.0.0",
    },
  },
  apis: ["service.js"], // API文档所在的文件路径
};

const swaggerDocs = swaggerJsDoc(swaggerOptions);

const apiRouter = express.Router(); // 创建一个新的路由器对象
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocs));

app.use(express.json());

const manager = new MySqlManager({
  host: "localhost",
  user: "root",
  password: "123456",
  database: "chat_bot",
});

/**
 * @swagger
 * /register:
 *   post:
 *     description: Greate a user
 *     responses:
 *       200:
 *         description: Returns a message
 */
apiRouter.post("/register", async (req, res) => {
  const { username, password } = req.body;
  console.log(req.body);
  try {
    await manager.connect();
    const rows = await manager.select("t_users", { username });

    if (!rows || rows.length === 0) {
      const insert = await manager.insert("t_users", {
        username,
        password,
        totalCount: INITAL_TOTAL_COUNT,
        status: INITAL_STATUS,
      });
      res.send({ message: "User registered successfully" });
    } else {
      res.status(400).send({ error: "Username already exists" });
    }
  } catch (error) {
    logger.error(error);
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

apiRouter.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    await manager.connect();
    const rows = await manager.select("t_users", { username, password });
    if (!rows || rows.length === 0) {
      res.status(401).send({ error: "Invalid username or password" });
    }
    const { id, status, totalCount } = rows[0];

    const token = jwt.sign({ username }, secret, { expiresIn: "168h" });
    console.log(token);

    res.send({
      message: "Login successful",
      token,
      data: { id, username, status, totalCount },
    });
  } catch (error) {
    console.error(error);
    logger.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

const authenticate = (req, res, next) => {
  const { authorization } = req.headers;

  if (!authorization) {
    return res.status(401).send({ error: "Authorization header is required" });
  }

  const [bearer, token] = authorization.split(" ");

  if (bearer !== "Bearer") {
    return res.status(401).send({ error: "Authorization header is invalid" });
  }
  try {
    const decoded = jwt.verify(token, secret);
    req.user = decoded;
    next();
  } catch (error) {
    console.error(error);
    logger.error(error);
    return res.status(401).send({ error: "Token is invalid or expired" });
  }
};

apiRouter.get("/userInfo", authenticate, async (req, res) => {
  try {
    await manager.connect();
    console.log(req.user);
    const user = await manager.select("t_users", {
      username: req.user.username,
    });
    console.log(user);
    if (!user || user.length === 0) {
      return res.status(201).send({ message: "用户不存在",code:ERROR_CODE_USER_NOT_EXIST });
    }
    const { id, username, status, totalCount } = user[0];

    res.send({ id, username, status, totalCount });
  } catch (error) {
    console.error(error);
    logger.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
});

apiRouter.post("/token", async (req, res) => {
  const { code, sharedUserId } = req.body;
  const options = {
    url:
      "https://api.weixin.qq.com/sns/jscode2session?appid=" +
      WX_APP_ID +
      "&secret=" +
      WX_APP_SECRET +
      "&js_code=" +
      code +
      "&grant_type=authorization_code",
    method: "GET",
  };

  request(options, async (error, response, body) => {
    if (error) {
      console.error(error);
      return res.status(500).send(error);
    }
    const today = new Date().toISOString().slice(0, 10);
    const data = JSON.parse(body); // 将响应体字符串解析为 JSON 对象
    const username = data.openid;
    const password = "123456";
    const token = jwt.sign({ username }, secret, { expiresIn: "168h" });
    try {
      await manager.connect();
      const rows = await manager.select("t_users", { username });
      console.log(rows);

      // 执行 MySQL 查询语句
      if (!rows || rows.length === 0) {
        if (sharedUserId) {
          const result = await manager.execute(
            "UPDATE t_users SET totalCount = totalCount + ?, status = 1 WHERE id = ?",
            [AWARD_COUNT, sharedUserId]
          );
        }
        const result = await manager.insert("t_users", {
          username,
          password,
          totalCount: INITAL_TOTAL_COUNT,
          status: INITAL_STATUS,
        });
      }
    } catch (error) {
      logger.error(error);
      console.log(error);
    }
    // await updateDailyCount(username);

    // console.log(response)
    res.send({ session_key: token });
  });
});

apiRouter.post("/chat", authenticate, async (req, res) => {
  const data = req.body;
  const options = {
    url: "http://18.206.232.23:8086/chat/completions",
    method: "POST",
    headers: {
      Authorization: SK_OPENAI_API_KEY,
      "Content-Type": "application/json",
    },
    json: data,
  };
  await manager.connect();
  const rows = await manager.select("t_users", { username: req.user.username });

  if (!rows || rows.length === 0) {
    return res.status(201).json({ message: "用户不存在",code:ERROR_CODE_USER_NOT_EXIST });
  }
  const item = rows[0];
  if (item.totalCount <= 0) {
    return res.status(201).json({ message: "toks 不够了.",code: ERROR_CODE_USER_COUNT_EMPTY });
  }

  request(options, async (error, response, body) => {
    if (error) {
      console.error(error);
      return res.status(500).send(error);
    }
    if (body.choices.length > 0) {
      const total_tokens = body.usage.total_tokens
      if (item.totalCount < total_tokens) {
        total_tokens = item.totalCount
      }
      const repMsg = body.choices[0].message;
      if (repMsg.content.length > 0) {
        try {
            if (item.totalCount > 0) {
              const result = await manager.execute(
                "UPDATE t_users SET totalCount = totalCount - ? WHERE username = ?",
                [total_tokens,req.user.username]
              );
            }
        } catch (error) {
          logger.error(error);
          console.error(error);
        }
      }
      res.send(body);
    }else{
      return res.status(201).json({ message: body,code: ERROR_CODE_USER_NOT_EXIST });
    }

  });
});

// 修改用户接口
apiRouter.post("/users/addCount", authenticate, async (req, res) => {
  const {totalCount } = req.body;

  if (!totalCount) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
  await manager.connect();
    if (totalCount) {
      const result = await manager.execute(
        "UPDATE t_users SET totalCount = totalCount + ? WHERE username = ?",
        [totalCount, req.user.username]
      );
      if (!result || result.affectedRows === 0) {
        return res.status(201).json({ message: "用户不存在",code:ERROR_CODE_USER_NOT_EXIST });
      }
    }

    const { id, totalCount, status } = result[0];
    res.json({ id, totalCount, status });
  } catch (err) {
    logger.error(err);
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
});

// 修改用户接口
apiRouter.post("/users/status", authenticate, async (req, res) => {
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ message: "参数不正确" });
  }

  try {
  await manager.connect();

    const result = await manager.update(
      "t_users",
      { totalCount, status },
      { username: req.user.username }
    );

    if (!result || result.affectedRows === 0) {
      return res.status(201).json({ message: "用户不存在",code:ERROR_CODE_USER_NOT_EXIST });
    }
    const { id, totalCount, status } = result[0];

    res.json({ id, totalCount, status });
  } catch (err) {
    console.error(err);
    logger.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
});

// 查询用户接口
apiRouter.get("/users", authenticate, async (req, res) => {
  try {
    // await updateDailyCount(req.user.username);
    const rows = await manager.select("t_users", {
      username: req.user.username,
    });
    // 执行 MySQL 查询语句

    if (!rows || rows.length === 0) {
      return res.status(201).json({ message: "用户不存在",code:ERROR_CODE_USER_NOT_EXIST });
    }

    const { id, totalCount, status } = rows[0];
    res.json({ id, totalCount, status });
  } catch (err) {
    console.error(err);
    logger.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
});

// async function updateDailyCount(username) {
//   //
//   const today = new Date().toISOString().slice(0, 10);

//   try {
//     await manager.connect();
//     const rows = await manager.execute(
//       "INSERT INTO t_user_daily (user_id, date, created_at, updated_at) " +
//         "SELECT ?, ?, NOW(), NOW() FROM DUAL " +
//         "WHERE NOT EXISTS (" +
//         "  SELECT id FROM t_user_daily WHERE user_id = ? AND date = ?" +
//         ")",
//       [username, today, username, today]
//     );
//     if (!rows || rows.affectedRows === 0) {
//     } else {
//       const result = await manager.update(
//         "t_users",
//         { dailyCount: DAILY_COUNT },
//         { username: username }
//       );
//     }
//   } catch (err) {
//     console.error(err);
//     logger.error(err);
//   }
// }

app.use("/api", apiRouter);

const server = require('http').createServer(app);
const io = require('socket.io')(server);
const chatNamespace = io.of('/api/chat')
const ioClient = require('socket.io-client');

// 连接 Flask SocketIO 服务器
const flaskSocket = ioClient('http://54.237.68.233:5000/chat');

// Socket
// 监听来自 Flask SocketIO 服务器的 stream_data 事件
flaskSocket.on('stream_data', (data) => {

  // 将数据转发给客户端
  chatNamespace.to(data.room).emit('stream_data', data.data);
});

// 监听来自 Flask SocketIO 服务器的 end_response 事件
flaskSocket.on('end_response', (data) => {

  console.log('end_response',data.data)

  // 将数据转发给客户端
  chatNamespace.to(data.room).emit('end_response', data.data);
});

// 监听来自 Flask SocketIO 服务器的 error_response 事件
flaskSocket.on('error_response', (data) => {

  console.log('error_response',data.data)

  // 将数据转发给客户端
  chatNamespace.to(data.room).emit('error_response', data.data);
});


// 监听来自客户端的连接事件
chatNamespace.on('connection', (socket) => {
  console.log('Client connected');
  // 监听来自客户端的消息事件
  socket.on('message', (data) => {

    // 将数据转发给 Flask SocketIO 服务器
    // flaskSocket.emit('message', data);
    flaskSocket.emit('message', data);
  });

  // 监听来自客户端的离开房间事件
  socket.on('leave_room', (data) => {
    // 将客户端从指定房间中移除
    socket.leave(data.room);
  });

  // 监听来自客户端的加入房间事件
  socket.on('join_room', (data) => {
    console.log(data.room)
    console.log("join_room")
    // 将客户端加入指定房间
    socket.join(data.room);
  });

  // 监听来自客户端的断开连接事件
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// 启动服务器
server.listen(9527, () => {
  console.log('Server running on port 9527');
});

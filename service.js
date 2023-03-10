const express = require('express');
const request = require('request');
const jwt = require('jsonwebtoken');
const MySqlManager = require('./dataManager');
const INITAL_TOTAL_COUNT = 5
const DAILY_COUNT = 3
const INITAL_STATUS = 0
const SK_OPENAI_API_KEY = ""
const WX_APP_ID = ""
const WX_APP_SECRET = ""
const secret = '';

const app = express();
app.use(express.json());

const manager = new MySqlManager({
  host: 'localhost',
  user: 'root',
  password: '123456',
  database: 'gitHub'
});

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  console.log(req.body)
  try {
    await manager.connect();
    const rows = await manager.select("t_users",{username})

    if (rows.length === 0) {
      const insert = await manager.insert("t_users",{username,password,totalCount:INITAL_TOTAL_COUNT,status:INITAL_STATUS,dailyCount:DAILY_COUNT})
      res.send({ message: 'User registered successfully' });
    }else{
      res.status(400).send({ error: 'Username already exists' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/login',async (req, res) => {
  const { username, password } = req.body;

  try {
    await manager.connect();
    const rows = await manager.select("t_users",{username,password})
    if (!rows || rows.length === 0) {
     res.status(401).send({ error: 'Invalid username or password' });
    }
    const {id,status,totalCount,dailyCount} = rows[0]

    const token = jwt.sign({ username }, secret, { expiresIn: '168h' });
    console.log(token)

    res.send({ message: 'Login successful', token ,data:{id,username,status,totalCount,dailyCount}});
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

const authenticate = (req, res, next) => {
  const { authorization } = req.headers;

  if (!authorization) {
    return res.status(401).send({ error: 'Authorization header is required' });
  }
  console.log(authorization)

  const [bearer, token] = authorization.split(' ');
  console.log(bearer)
  console.log(token)

  if (bearer !== 'Bearer') {
    return res.status(401).send({ error: 'Authorization header is invalid' });
  }
  try {
    const decoded = jwt.verify(token, secret);
    req.user = decoded;
    next();
  } catch (error) {
    console.error(error);
    return res.status(401).send({ error: 'Token is invalid or expired' });
  }
};

app.get('/userInfo', authenticate, async (req, res) => {
  try {
    await manager.connect();
    console.log(req.user)
    const user = await manager.select("t_users",{username:req.user.username})
    console.log(user)
    if (!user || user.length === 0) {
      return res.status(201).send({ error: 'User is not exist' });
    }
    const {id,username,status,totalCount,dailyCount} = user[0]

    res.send({id,username,status,totalCount,dailyCount})
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


app.get('/token/:code', async (req, res) => {
  const { code } = req.params;
  const options = {
    url: "https://api.weixin.qq.com/sns/jscode2session?appid=" + WX_APP_ID+"&secret=" + WX_APP_SECRET + "&js_code=" + code + "&grant_type=authorization_code" ,
    method: 'GET'
  };

  request(options, async (error, response, body) => {
    if (error) {
      console.error(error);
      return res.status(500).send(error);
    }
    const today = new Date().toISOString().slice(0, 10);
    const data = JSON.parse(body); // ?????????????????????????????? JSON ??????
    const username = data.openid
    const password = "123456"
    const token = jwt.sign({ username }, secret, { expiresIn: '168h' });

    try {
      await manager.connect();
      const rows = await manager.select("t_users",{username})
      // ?????? MySQL ????????????
      if (rows.length === 0) {
        const result = await manager.insert("t_users",{username,password,totalCount:INITAL_TOTAL_COUNT,status:INITAL_STATUS,dailyCount:DAILY_COUNT})
      }

    } catch (error) {
      console.log(error)
    }
    await updateDailyCount(username);

    // console.log(response)
    res.send({session_key:token});
  });
});


app.post('/chat',authenticate, async (req, res) => {
  const data = req.body;
  const options = {
    url: 'http://54.160.114.251:8086/chat/completions',
    method: 'POST',
    headers: {
      'Authorization':SK_OPENAI_API_KEY,
      'Content-Type': 'application/json'
    },
    json: data
  };

  const rows = await manager.select("t_users",{username:req.user.username})
  if (rows.length === 0) {
    return res.status(201).json({ message: '???????????????' });
  }
  const item = rows[0];
  if (item.totalCount <= 0 && item.dailyCount <= 0) {
    return res.status(201).json({ message: '???????????????.' });
  }

  request(options, async (error, response, body) => {
    if (error) {
      console.error(error);
      return res.status(500).send(error);
    }
    try {
      if (item.dailyCount > 0) {
        const result = await manager.execute('UPDATE t_users SET dailyCount = dailyCount - 1 WHERE username = ?', [req.user.username])
      }else{
        if (item.totalCount > 0) {
          const result = await manager.execute('UPDATE t_users SET totalCount = totalCount - 1 WHERE username = ?', [req.user.username])
        }
      }
    } catch (error) {
      console.error(error);
    }
    res.send(body);
  });
});

// ??????????????????
app.post('/users/addCount',authenticate, async (req, res) => {
  const { totalCount, dailyCount } = req.body;

  if (!totalCount && !dailyCount) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  try {
    if (totalCount) {
      const result = await manager.execute('UPDATE t_users SET totalCount = totalCount + ? WHERE username = ?', [totalCount,req.user.username])
      if (result.affectedRows === 0) {
        return res.status(201).json({ message: '???????????????' });
      }
    }
    if (dailyCount) {
      const result = await manager.execute('UPDATE t_users SET dailyCount = dailyCount + ? WHERE username = ?', [dailyCount,req.user.username])
      if (result.affectedRows === 0) {
        return res.status(201).json({ message: '???????????????' });
      }
    }

    const { id, totalCount, status, dailyCount} = result[0];
    res.json({ id, totalCount, status, dailyCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ??????????????????
app.post('/users/status',authenticate, async (req, res) => {
  const { status } = req.body;

  if (!status ) {
    return res.status(400).json({ message: '???????????????' });
  }

  try {
    const result = await manager.update("t_users",{totalCount,status,dailyCount},{username:req.user.username})

    if (result.affectedRows === 0) {
      return res.status(201).json({ message: '???????????????' });
    }
    const { id, totalCount, status, dailyCount} = result[0];

    res.json({ id, totalCount, status, dailyCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ??????????????????
app.get('/users',authenticate, async (req, res) => {
  try {
    await updateDailyCount(req.user.username);
    const rows = await manager.select("t_users",{username:req.user.username})
    // ?????? MySQL ????????????

    if (rows.length === 0) {
      const result = await manager.insert("t_users",{username:req.user.username,totalCount:INITAL_TOTAL_COUNT,status:INITAL_STATUS,dailyCount:DAILY_COUNT})
     return res.json({ id: result.insertId, totalCount:INITAL_TOTAL_COUNT, status:INITAL_STATUS, dailyCount:DAILY_COUNT });
    }

    const { id, totalCount, status, dailyCount} = rows[0];
    res.json({ id, totalCount, status, dailyCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

async function updateDailyCount(username)  {
  // 
  const today = new Date().toISOString().slice(0, 10);

  try {
    await manager.connect();
    const rows = await manager.execute('INSERT INTO t_user_daily (user_id, date, created_at, updated_at) ' +
    'SELECT ?, ?, NOW(), NOW() FROM DUAL ' +
    'WHERE NOT EXISTS (' +
    '  SELECT id FROM t_user_daily WHERE user_id = ? AND date = ?' +
    ')',
    [username, today, username, today]
    );
    if (rows.affectedRows === 0) {
      
    }else{
      const result = await manager.update("t_users",{dailyCount:DAILY_COUNT},{username:username})
    }
  } catch (err) {
    console.error(err);
  }
}

// ???????????????
app.listen(9527, () => {
  console.log('Server started on port 9527');
});



const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const datetimeNew = require("date-fns");

const formatDate = require("date-fns/format");

const datetime = new Date();

const currentDate = formatDate(new Date(datetime), "yyyy-MM-dd hh:mm:ss");

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
const dbPath = path.join(__dirname, "twitterClone.db");
app.use(express.json());

let database = null;

const initializeDbAndServer = async () => {
  try {
    database = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () =>
      console.log("server running at http://localhost:3000/")
    );
  } catch (error) {
    console.log(`DB error: ${error.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

const checkUserExists = async (request, response, next) => {
  const { username, password } = request.body;
  const getUserQuery = `
    SELECT 
      username 
    FROM 
      user 
    WHERE 
      username = '${username}';`;
  const userArray = await database.get(getUserQuery);
  if (userArray !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else if (password.length < 6) {
    response.status(400);
    response.send("Password is too short");
  } else {
    next();
  }
};

app.post("/register/", checkUserExists, async (request, response) => {
  console.log("posted");
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const createUserQuery = `
    INSERT INTO 
      user (username, password, name, gender) 
    VALUES ( 
        '${username}', 
        '${hashedPassword}', 
        '${name}', 
        '${gender}'
    );`;
  await database.run(createUserQuery);
  response.send("User created successfully");
});

const checkCredentials = async (request, response, next) => {
  const { username, password } = request.body;
  const getUserQuery = `
    SELECT 
      username, 
      password 
    FROM 
      user 
    WHERE 
      username = '${username}';`;
  const getUserArray = await database.get(getUserQuery);
  if (getUserArray !== undefined) {
    const isPasswordChecked = await bcrypt.compare(
      password,
      getUserArray.password
    );
    if (isPasswordChecked) {
      next();
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  } else {
    response.status(400);
    response.send("Invalid user");
  }
};

app.post("/login/", checkCredentials, (request, response) => {
  const { username } = request.body;
  const payLoad = { username: username };
  const jwtToken = jwt.sign(payLoad, "prem_kumar");
  response.send({ jwtToken });
});

const authenticateToken = (request, response, next) => {
  const authHeader = request.headers["authorization"];
  const jwtTokenReq = authHeader.split(" ")[1];
  if (authHeader === undefined && jwtTokenReq === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtTokenReq, "prem_kumar", (error, payLoad) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payLoad.username;
        next();
      }
    });
  }
};

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request;
  console.log(username);
  const getTweetsQuery = `
    SELECT 
      username, 
      tweet, 
      date_time AS dateTime 
    FROM 
      user INNER JOIN follower 
      ON user.user_id = follower.follower_user_id INNER JOIN tweet 
      ON tweet.user_id = user.user_id 
    WHERE 
      following_user_id IN (
          SELECT following_user_id 
          FROM 
            user INNER JOIN follower 
            ON user.user_id = follower.following_user_id 
          WHERE username = '${username}'
      )
    ORDER BY 
      tweet.date_time DESC 
    LIMIT 4;`;
  const getTweetsArray = await database.all(getTweetsQuery);
  response.send(getTweetsArray);
});

app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getUserFoll = `
    SELECT 
      username AS name
    FROM 
      user INNER JOIN follower 
      ON user.user_id = follower.follower_user_id 
    WHERE 
      following_user_id IN (
          SELECT 
            following_user_id 
          FROM 
            user INNER JOIN follower 
            ON user.user_id = follower.following_user_id 
          WHERE 
            username = '${username}'
      );`;
  const getUserFollArray = await database.all(getUserFoll);
  response.send(getUserFollArray);
});

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getFollowerQuery = `
    SELECT 
      username AS name 
    FROM 
      user INNER JOIN follower 
      ON user.user_id = follower.following_user_id 
    WHERE 
      follower_user_id IN (
          SELECT 
            follower_user_id 
          FROM 
            user INNER JOIN follower 
            ON user.user_id = follower.follower_user_id 
          WHERE 
            username = '${username}'
      );`;
  const getUserFollowerArray = await database.all(getFollowerQuery);
  response.send(getUserFollowerArray);
});

app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { username } = request;
  const { tweetId } = request.params;
  const getTweetQuery = `
    SELECT 
      tweet, 
      COUNT(like.like_id) AS likes, 
      COUNT(reply.reply_id) AS replies, 
      date_time AS dateTime 
    FROM 
      tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id 
      INNER JOIN reply ON tweet.tweet_id = reply.tweet_id 
    WHERE 
      tweet.tweet_id = ${tweetId} 
       AND tweet.tweet_id IN (
            SELECT 
              tweet_id 
            FROM 
              user INNER JOIN follower ON user.user_id = follower.follower_user_id 
              INNER JOIN tweet ON tweet.user_id = user.user_id 
            WHERE 
              following_user_id IN (
                SELECT following_user_id 
                FROM 
                  user INNER JOIN follower 
                  ON user.user_id = follower.following_user_id 
                WHERE 
                  username = '${username}'
              )
       );`;
  const getTweetArray = await database.get(getTweetQuery);
  if (getTweetArray.tweet !== null) {
    response.send(getTweetArray);
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const getUserLikesQuery = `
    SELECT 
      username
    FROM 
      user INNER JOIN like ON user.user_id = like.user_id 
    WHERE 
      like_id IN (
        SELECT 
         like.like_id 
        FROM 
          tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id 
          INNER JOIN reply ON tweet.tweet_id = reply.tweet_id 
        WHERE 
          tweet.tweet_id = ${tweetId} 
        AND tweet.tweet_id IN (
            SELECT 
              tweet_id 
            FROM 
              user INNER JOIN follower ON user.user_id = follower.follower_user_id 
              INNER JOIN tweet ON tweet.user_id = user.user_id 
            WHERE 
              following_user_id IN (
                SELECT following_user_id 
                FROM 
                  user INNER JOIN follower 
                  ON user.user_id = follower.following_user_id 
                WHERE 
                  username = '${username}'
              )
              )
      );`;
    const getUserLikesArray = await database.all(getUserLikesQuery);
    if (getUserLikesArray.length !== 0) {
      let newList = [];
      for (let user in getUserLikesArray) {
        newList.push(getUserLikesArray[user].username);
      }
      let newArray = {
        likes: newList,
      };
      response.send(newArray);
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const getUserLikesQuery = `
    SELECT 
      username AS name, 
      reply
    FROM 
      user INNER JOIN reply ON user.user_id = reply.user_id 
    WHERE 
      reply_id IN (
        SELECT 
         reply.reply_id 
        FROM 
          tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id 
          INNER JOIN reply ON tweet.tweet_id = reply.tweet_id 
        WHERE 
          tweet.tweet_id = ${tweetId} 
        AND tweet.tweet_id IN (
            SELECT 
              tweet_id 
            FROM 
              user INNER JOIN follower ON user.user_id = follower.follower_user_id 
              INNER JOIN tweet ON tweet.user_id = user.user_id 
            WHERE 
              following_user_id IN (
                SELECT following_user_id 
                FROM 
                  user INNER JOIN follower 
                  ON user.user_id = follower.following_user_id 
                WHERE 
                  username = '${username}'
              )
              )
      );`;
    const getUserLikesArray = await database.all(getUserLikesQuery);
    if (getUserLikesArray.length !== 0) {
      let newArray = {
        replies: getUserLikesArray,
      };
      response.send(newArray);
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getTweetsQuery = `
    SELECT 
      tweet, 
      COUNT(like_id) AS likes, 
      COUNT(reply_id) AS replies, 
      date_time AS dateTime 
    FROM 
      user INNER JOIN tweet ON user.user_id = tweet.user_id 
      LEFT JOIN like ON tweet.user_id = like.user_id LEFT JOIN reply 
      ON tweet.user_id = reply.user_id 
    WHERE 
      user.username = '${username}' 
    GROUP BY 
      tweet.tweet_id;`;
  const getTweetArray = await database.all(getTweetsQuery);
  response.send(getTweetArray);
});

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const { tweet } = request.body;
  const getUserId = `
    SELECT 
     user_id 
    FROM 
     user 
    WHERE 
     username = '${username}';`;
  const getUserIdArray = await database.get(getUserId);
  const createUserTweet = `
    INSERT INTO 
      tweet (tweet, user_id, date_time) 
    VALUES (
      '${tweet}', 
      ${getUserIdArray.user_id}, 
      '${currentDate}'
    );`;
  await database.run(createUserTweet);
  response.send("Created a Tweet");
});

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const selectUserTweet = `
        SELECT 
          tweet_id 
        FROM 
          tweet INNER JOIN  user ON tweet.user_id = user.user_id 
        WHERE 
          tweet_id = ${tweetId} 
          AND user.username = '${username}';`;
    const isTweetBelongsToUser = await database.get(selectUserTweet);
    if (isTweetBelongsToUser !== undefined) {
      const deleteUserTweet = `
            DELETE FROM 
              tweet 
            WHERE 
              tweet_id = ${tweetId};`;
      await database.run(deleteUserTweet);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;

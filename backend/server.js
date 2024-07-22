require('dotenv').config();
const express = require("express"),
       app = express(),
       port = process.env.PORT || 8080,
       cors = require("cors");
const bodyParser = require('body-parser');
const fsPromises = require("fs").promises;
const todoDBName = "tododb";
const useCloudant = true;

const basicAuth = require("express-basic-auth");
var { authenticator, upsertUser, cookieAuth } = require("./authentication");
const auth = basicAuth({
    authorizer: authenticator
});
const cookieParser = require("cookie-parser");
app.use(cookieParser("82e4e438a0705fabf61f9854e3b575af"));

// Init code for Cloudant
const { CloudantV1, IamAuthenticator } = require('@ibm-cloud/cloudant');

if (useCloudant) {
    initDB();
}

app.use(cors({
  credentials: true,
  origin: 'http://localhost:3000'
}));
app.use(bodyParser.json({ extended: true }));

app.listen(port, () => console.log("Backend server live on " + port));

app.get("/", (request, response) => {
    response.send({ message: "Connected to Backend server!" });
});

app.get("/authenticate", auth, (req, res) => {
  console.log(`user logging in: ${req.auth.user}`);
  res.cookie('user', req.auth.user, { signed: true });
  res.sendStatus(200);
});

app.post("/users", (req, res) => {
  const b64auth = (req.headers.authorization || '').split(' ')[1] || ''
  const [username, password] = Buffer.from(b64auth, 'base64').toString().split(':')
  const upsertSucceeded = upsertUser(username, password)
  res.sendStatus(upsertSucceeded ? 200 : 401);
});

app.get("/logout", (req, res) => {
  res.clearCookie('user');
  res.end();
});

app.post("/items", cookieAuth, addItem);
app.get("/items", cookieAuth, getItems);
app.get("/items/search", cookieAuth, searchItems);

// Add new item to JSON file
app.post("/add/item", addItem);

async function addItem(request, response) {
    try {
        const id = request.body.jsonObject.id;
        const task = request.body.jsonObject.task;
        const curDate = request.body.jsonObject.currentDate;
        const dueDate = request.body.jsonObject.dueDate;
        const newTask = {
            ID: id,
            Task: task,
            Current_date: curDate,
            Due_date: dueDate
        };

        if (useCloudant) {
            const todoDocument = { _id: id.stringify };
            todoDocument['task'] = task;
            todoDocument.curDate = curDate;
            todoDocument.dueDate = dueDate;

            const client = CloudantV1.newInstance({
                authenticator: new IamAuthenticator({
                    apikey: process.env.CLOUDANT_APIKEY
                })
            });
            client.setServiceUrl(process.env.CLOUDANT_URL);

            console.log('Writing to: ', todoDBName);
            const createDocumentResponse = await client.postDocument({
                db: todoDBName,
                document: todoDocument,
            });
            console.log('Successfully wrote to Cloudant DB');
        } else {
            const data = await fsPromises.readFile("database.json");
            const json = JSON.parse(data);
            json.push(newTask);
            await fsPromises.writeFile("database.json", JSON.stringify(json));
            console.log('Successfully wrote to file');
        }
        response.sendStatus(200);
    } catch (err) {
        console.log("error: ", err);
        response.sendStatus(500);
    }
}

// Get all items from the JSON database
app.get("/get/items", getItems);
async function getItems(request, response) {
    if (useCloudant) {
        const client = CloudantV1.newInstance({
            authenticator: new IamAuthenticator({
                apikey: process.env.CLOUDANT_APIKEY
            })
        });
        client.setServiceUrl(process.env.CLOUDANT_URL);

        var listofdocs;
        await client.postAllDocs({
            db: todoDBName,
            includeDocs: true
        }).then(response => {
            listofdocs = response.result;
        });
        response.json(JSON.stringify(listofdocs));
    } else {
        var data = await fsPromises.readFile("database.json");
        response.json(JSON.parse(data));
    }
}

// Search items service
app.get("/get/searchitem", searchItems);
async function searchItems(request, response) {
    var searchField = request.query.taskname;

    if (useCloudant) {
        const client = CloudantV1.newInstance({
            authenticator: new IamAuthenticator({
                apikey: process.env.CLOUDANT_APIKEY
            })
        });
        client.setServiceUrl(process.env.CLOUDANT_URL);

        var search_results;
        await client.postSearch({
            db: todoDBName,
            ddoc: 'newdesign',
            query: 'task:' + searchField,
            index: 'newSearch'
        }).then(response => {
            search_results = response.result;
            console.log(response.result);
        });
        console.log(search_results);
        response.json(JSON.stringify(search_results));
    } else {
        var json = JSON.parse(await fsPromises.readFile("database.json"));
        var returnData = json.filter(jsondata => jsondata.Task === searchField);
        response.json(returnData);
    }
}

// Add initDB function here
async function initDB() {
    try {
        const client = CloudantV1.newInstance({
            authenticator: new IamAuthenticator({
                apikey: process.env.CLOUDANT_APIKEY
            })
        });
        client.setServiceUrl(process.env.CLOUDANT_URL);

        const putDatabaseResult = (
            await client.putDatabase({
                db: todoDBName,
            })
        ).result;
        if (putDatabaseResult.ok) {
            console.log(`"${todoDBName}" database created.`);
        }
    } catch (err) {
        console.log(`Cannot create "${todoDBName}" database, err: "${err.message}".`);
    }
}
